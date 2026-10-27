import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

import { buildCatalogCsv, catalogRevision, sha256Hex, signCatalogCsv } from "@/lib/catalog-sync"
import { listAdminProducts } from "@/lib/product-admin-service"
import { authorizeCatalogRequest } from "@/lib/catalog-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 运营方侧：把本机产品库作为「官方产品资料」发布给订阅设备。
 *
 * 这条路径在主仓库（正式版）上才有意义；自部署版把它当作可选项。
 * 守卫只有一件事：`CATALOG_PUBLISH_TOKEN` 对得上的 Bearer 才能拿。
 * 没配这个变量就当作该功能没开（404），不会给出一份空目录。
 */
export async function GET(request: NextRequest) {
  // 一机一密：客户设备带自己那份凭据；运营方仍可用 CATALOG_PUBLISH_TOKEN 当总钥匙。
  const auth = await authorizeCatalogRequest(request)
  if (!auth.ok) return auth.response

  // 只发布目录里已通过审核的产品：待审核/已驳回/停用的不进订阅设备。
  const products = (await listAdminProducts(null)).filter((product) => product.status === "approved" || product.status === "active")
  const csv = buildCatalogCsv(products)

  // 配了私钥就随包给一个 Ed25519 签名：设备侧能用公钥确认「这份目录是谁发的」。
  // 没配私钥时不给签名头，设备若配了公钥会拒收（除非显式允许无签名）。
  let signature = ""
  try {
    const signingKey = (process.env.CATALOG_SIGNING_KEY ?? "").replace(/\\n/g, "\n").trim()
    if (signingKey) signature = signCatalogCsv(csv, signingKey)
  } catch (error) {
    return NextResponse.json({ error: "CATALOG_SIGNING_FAILED", message: error instanceof Error ? error.message : "签名私钥无效" }, { status: 500 })
  }

  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/csv; charset=utf-8",
      // 摘要用于发现传输截断或改动；rev 用于判断「和上次是不是同一份」。
      "X-Catalog-Revision": catalogRevision(csv),
      "X-Catalog-Sha256": sha256Hex(csv),
      ...(signature ? { "X-Catalog-Signature": signature, "X-Catalog-Signature-Alg": "ed25519" } : {}),
    },
  })
}
