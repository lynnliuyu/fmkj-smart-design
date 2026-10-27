/**
 * 取资料请求的凭据校验：一机一密 + 环境变量「总钥匙」。
 *
 * 两个入口共用（快照与图片），避免两处各写一遍、日后改一处漏一处：
 *   - 客户设备：带自己那一份凭据 → 查表（哈希）→ 记一次取用（谁在用、什么时候）。
 *   - 运营方/自部署：环境变量 CATALOG_PUBLISH_TOKEN 仍然可用，当总钥匙。
 * 没配环境变量且表里也没有启用的凭据 → 当作该功能没开（404），不给空目录。
 */
import { NextResponse } from "next/server"

import { recordCatalogLicenseUse, safeEqual, verifyCatalogLicense } from "./catalog-licenses"

export type CatalogAuthResult =
  | { ok: true; licenseId: string | null; via: "env" | "license" }
  | { ok: false; response: NextResponse }

export async function authorizeCatalogRequest(
  request: Request,
  options: { licenseRequired?: boolean } = {},
): Promise<CatalogAuthResult> {
  const expected = (process.env.CATALOG_PUBLISH_TOKEN ?? "").trim()
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()

  if (expected && safeEqual(provided, expected)) return { ok: true, licenseId: null, via: "env" }

  const license = provided ? await verifyCatalogLicense(provided) : null
  if (license) {
    const instanceId = request.headers.get("x-instance-id")
    void recordCatalogLicenseUse(license.id, instanceId)
    return { ok: true, licenseId: license.id, via: "license" }
  }

  if (!expected) {
    // 环境变量没配：只有在表里已经有凭据时才继续按一机一密判；否则这项功能视为未开。
    const anyLicense = provided ? null : await hasAnyLicense()
    if (!anyLicense && !options.licenseRequired) {
      return { ok: false, response: NextResponse.json({ error: "CATALOG_PUBLISH_DISABLED" }, { status: 404 }) }
    }
    if (!anyLicense && options.licenseRequired) {
      return { ok: false, response: NextResponse.json({ error: "CATALOG_PUBLISH_DISABLED" }, { status: 404 }) }
    }
  }

  return { ok: false, response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) }
}

async function hasAnyLicense(): Promise<boolean> {
  try {
    const { getPool } = await import("./server-db")
    const result = await getPool().query("select 1 from catalog_licenses where enabled limit 1")
    return Boolean(result.rowCount)
  } catch {
    return false
  }
}
