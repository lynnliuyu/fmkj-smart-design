import { readFile, stat } from "node:fs/promises"
import { join, normalize, resolve, sep } from "node:path"
import { NextRequest, NextResponse } from "next/server"

import { sha256Hex } from "@/lib/catalog-sync"
import { authorizeCatalogRequest } from "@/lib/catalog-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 官方产品资料里的图片：按路径把本站 public 目录下的素材发给订阅设备。
 *
 * 为什么需要它：目录里的 `image` 是 `/placeholder.svg` 这种站内路径。
 * 设备上没有这些文件，同步过去的目录会全是破图。设备侧拿到字节后存进自己的
 * 上传卷，再把 `products.image` 改成本地可读地址。
 *
 * 守卫与快照接口一致（Bearer CATALOG_PUBLISH_TOKEN）；路径只允许落在 public 下，
 * 且只允许图片扩展名——这个接口不该变成「任意文件下载」。
 */

const ALLOWED = /\.(png|jpe?g|webp|gif|avif|svg)$/i

function contentTypeFor(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? ""
  if (extension === "png") return "image/png"
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "webp") return "image/webp"
  if (extension === "gif") return "image/gif"
  if (extension === "avif") return "image/avif"
  if (extension === "svg") return "image/svg+xml"
  return "application/octet-stream"
}

export async function GET(request: NextRequest) {
  // 与快照接口同一套凭据（一机一密 + 环境变量总钥匙），别让两处守卫走偏。
  const auth = await authorizeCatalogRequest(request)
  if (!auth.ok) return auth.response

  const requested = new URL(request.url).searchParams.get("path") ?? ""
  if (!requested.startsWith("/assets/") || requested.includes("\\") || requested.includes("\0")) {
    return NextResponse.json({ error: "ASSET_PATH_INVALID" }, { status: 400 })
  }
  // 先判路径再判类型：路径里出现 .. 或空段一律拒绝（这里只发 public 下的素材）。
  const segments = requested.split("/").slice(1)   // 去掉开头的空段
  if (!segments.length || segments.some((part) => part === ".." || part === "." || part === "")) {
    return NextResponse.json({ error: "ASSET_PATH_INVALID" }, { status: 400 })
  }
  if (!ALLOWED.test(requested)) return NextResponse.json({ error: "ASSET_TYPE_NOT_ALLOWED" }, { status: 415 })

  const root = resolve(process.cwd(), "public")
  const target = normalize(join(root, requested))
  if (!target.startsWith(root + sep) && target !== root) {
    return NextResponse.json({ error: "ASSET_PATH_INVALID" }, { status: 400 })
  }

  try {
    const info = await stat(target)
    if (!info.isFile()) return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404 })
    const bytes = await readFile(target)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": contentTypeFor(requested),
        // 设备侧用它核对字节有没有在传输中损坏。
        "X-Asset-Sha256": sha256Hex(bytes.toString("base64")),
      },
    })
  } catch {
    return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404 })
  }
}
