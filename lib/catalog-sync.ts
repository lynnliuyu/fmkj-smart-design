import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto"

import type { AdminProduct } from "./product-admin-service"
import { joinProductPlatforms } from "./product-platforms"
import { IMPORT_COLUMNS, parseCsv } from "./product-import"

/**
 * 官方产品资料同步（设备 ← 运营方服务器）。
 *
 * 形态取舍：**用与批量导入同一套 CSV 约定**，而不是另造一套增量协议。
 * 好处是设备侧不需要第二套解析、校验和写入逻辑——同步拿到的就是一张表，
 * 走的是同一个预演/落库通道，幂等、跳过、不绕过业务校验这些性质自动成立。
 *
 * 与 `docs/local-appliance-deployment.md` 第 5 节的合同相比，本版**故意少做**（见该节
 * 「当前实现到哪一步」）：没有签名验签、没有素材下载、没有分批游标与逐项冲突选择。
 * 传输完整性用内容摘要兜底，授权就是 Bearer 凭据本身。
 *
 * 只收产品资料，不发送任何业务数据（ADR 0010）：请求里只有实例标识、凭据和软件版本。
 */

export type CatalogSyncConfig = {
  baseUrl: string
  enabled: boolean
  instanceId: string
  licenseKey: string
  /** 运营方的公钥（PEM）。配了就必须验签；没配则接受无签名资料但在记录里标明。 */
  publicKey: string
  /** 配了公钥却仍允许无签名资料时为 true（默认不允许）。 */
  allowUnsigned: boolean
}

export type CatalogSignatureState = "verified" | "unsigned"

export type CatalogSnapshot = {
  csv: string
  revision: string
  signature: CatalogSignatureState
}

export function catalogSyncConfig(env: Record<string, string | undefined> = process.env): CatalogSyncConfig {
  return {
    baseUrl: String(env.UPSTREAM_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    enabled: String(env.UPSTREAM_ENABLED ?? "").trim().toLowerCase() === "true",
    instanceId: String(env.INSTANCE_ID ?? "").trim(),
    licenseKey: String(env.LICENSE_KEY ?? "").trim(),
    // 环境变量里换行会被写成 \n，这里还原成真正的换行，省得运维手工拼接时踩坑。
    publicKey: String(env.UPSTREAM_PUBLIC_KEY ?? "").replace(/\\n/g, "\n").trim(),
    allowUnsigned: String(env.UPSTREAM_ALLOW_UNSIGNED ?? "").trim().toLowerCase() === "true",
  }
}

/** 配齐了才去连：少一样都当作「这台设备没接官方资料」，不当成错误。 */
export function catalogSyncReady(config: CatalogSyncConfig): boolean {
  return Boolean(config.enabled && config.baseUrl && config.licenseKey)
}

export function snapshotUrl(config: CatalogSyncConfig): string {
  return `${config.baseUrl}/api/catalog/snapshot`
}

/**
 * 运营方侧签名：对资料原文做 Ed25519 签名。
 * 私钥只在运营方服务器上，设备只有公钥——所以设备能确认「这份目录确实是你发的」，
 * 而不只是「没被改动过」（摘要在中间人手里可以连内容一起换掉）。
 */
export function signCatalogCsv(csv: string, privateKeyPem: string): string {
  return sign(null, Buffer.from(csv, "utf8"), createPrivateKey(privateKeyPem)).toString("base64")
}

/** 设备侧验签。公钥格式不对、签名不匹配都返回 false，不抛异常。 */
export function verifyCatalogSignature(csv: string, signature: string, publicKeyPem: string): boolean {
  if (!signature || !publicKeyPem) return false
  try {
    return verify(null, Buffer.from(csv, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"))
  } catch {
    return false
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** 短摘要：用来判断「和上次拿到的是不是同一份」，不是安全边界。 */
export function catalogRevision(csv: string): string {
  return sha256Hex(csv).slice(0, 16)
}

export type FetchDependencies = { fetch?: typeof fetch }

/**
 * 拉一份资料快照。任何一步不对都抛错，由调用方降级为「本地继续用旧资料」。
 * 有摘要头时用它校验完整性：网络截断或中间被改过都会被拦下。
 */
export async function fetchCatalogSnapshot(
  config: CatalogSyncConfig,
  dependencies: FetchDependencies = {},
): Promise<CatalogSnapshot> {
  const doFetch = dependencies.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(snapshotUrl(config), {
      headers: {
        authorization: `Bearer ${config.licenseKey}`,
        "x-instance-id": config.instanceId,
      },
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code
    throw new Error(cause ? `连不上官方资料服务：${cause}` : `连不上官方资料服务：${error instanceof Error ? error.message : error}`)
  }
  if (response.status === 401 || response.status === 403) throw new Error("凭据无效或已过期，本次不同步（本地资料继续可用）")
  if (!response.ok) throw new Error(`官方资料服务返回 ${response.status}`)

  const csv = await response.text()
  const declared = response.headers.get("x-catalog-sha256") ?? ""
  if (declared && declared !== sha256Hex(csv)) {
    throw new Error("资料摘要对不上，可能在传输中被截断或改动，本次不应用")
  }

  let signature: CatalogSignatureState = "unsigned"
  if (config.publicKey) {
    const provided = response.headers.get("x-catalog-signature") ?? ""
    if (!provided) {
      if (!config.allowUnsigned) throw new Error("这份资料没有签名：已配置公钥的设备只接受签过名的目录")
    } else if (!verifyCatalogSignature(csv, provided, config.publicKey)) {
      throw new Error("资料签名校验不通过：可能不是你信任的运营方发布的，本次不应用")
    } else {
      signature = "verified"
    }
  }

  return { csv, revision: response.headers.get("x-catalog-revision") || catalogRevision(csv), signature }
}

export type CatalogAsset = { bytes: Buffer; contentType: string }

/** 拉一张官方素材（产品图）。失败由调用方决定是整批失败还是只记一行。 */
export async function fetchCatalogAsset(
  config: CatalogSyncConfig,
  path: string,
  dependencies: FetchDependencies = {},
): Promise<CatalogAsset> {
  const doFetch = dependencies.fetch ?? fetch
  const url = `${config.baseUrl}/api/catalog/asset?path=${encodeURIComponent(path)}`
  const response = await doFetch(url, {
    headers: { authorization: `Bearer ${config.licenseKey}`, "x-instance-id": config.instanceId },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`素材 ${path} 下载失败（${response.status}）`)
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  }
}

function cell(value: unknown): string {
  const text = String(value ?? "")
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 运营方侧：把本机产品库导出成快照 CSV。
 * 列与批量导入模板一致，设备拿到的就是可以直接预演的一张表。
 */
/**
 * 把资料里的成本列清空。
 *
 * 发布端已经不发了，这里再兜一道：万一设备连的是旧版主站、或者有人手工塞了一份带成本的
 * 目录，也不该把运营方的进货价写进经销商设备。列保留（表头不动），值一律清空。
 */
export function stripCostColumn(csv: string): string {
  const rows = parseCsv(csv)
  if (!rows.length) return csv
  const index = rows[0].findIndex((header) => {
    const name = header.trim().toLowerCase()
    return name === "成本" || name === "cost" || name === "成本价" || name === "进价"
  })
  if (index < 0) return csv
  return rows.map((row) => row.map((value, position) => (position === index ? "" : cell(value))).join(",")).join("\n")
}

export function buildCatalogCsv(products: AdminProduct[]): string {
  const header = IMPORT_COLUMNS.map((column) => column.label)
  const rows = products.map((product) => IMPORT_COLUMNS.map((column) => {
    switch (column.key) {
      case "sku": return cell(product.sku)
      case "name": return cell(product.name)
      case "brand": return cell(product.brand ?? "")
      // 生态平台是多值：导出成「米家;Apple Home」，导入时再归一回来。
      case "platform": return cell(joinProductPlatforms(product.platforms ?? (product.platform ? [product.platform] : [])))
      case "category": return cell(product.category ?? "")
      case "deviceTypeId": return cell(product.deviceTypeId ?? "")
      case "manufacturerModel": return cell(product.manufacturerModel ?? "")
      case "series": return cell(product.series ?? "")
      case "specs": return cell(Object.entries(product.specs ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(";"))
      case "protocols": return cell((product.protocols ?? []).join(";"))
      case "capabilities": return cell((product.capabilities ?? []).join(";"))
      case "image": return cell(product.image ?? "")
      case "catalogKind": return cell(product.catalogKind)
      case "unit": return cell(product.unit)
      case "price": return cell(product.price)
      // 成本价不下发：那是运营方自己的进货价，发给经销商等于把底价摊开。
      // 设备上的「成本」应该是经销商自己的进价，让他们自己填。
      case "cost": return cell("")
      case "stock": return cell(product.stock)
      case "tags": return cell(product.tags.join(";"))
      case "channels": return cell(product.channels.join(";"))
      case "description": return cell(product.description ?? "")
      // 核验状态与依据一起下发：没有依据的「已核验」到设备上会被写入服务拒绝，
      // 这里如实导出，让设备上的预演能看见问题，而不是悄悄丢掉。
      case "selectionStatus": return cell(product.selectionStatus)
      case "selectionEvidence": return cell(product.selectionEvidence ?? "")
      case "pricingStatus": return cell(product.pricingStatus)
      case "pricingEvidence": return cell(product.pricingEvidence ?? "")
      default: return ""
    }
  }))
  return [header, ...rows].map((row) => row.join(",")).join("\r\n") + "\r\n"
}

/**
 * 把「客户自己的字段」从官方资料里清空（空单元格 = 不改这一项）。
 *
 * 用户 2026-10-23 定的规则 B：官方同步只更新**官方字段**
 * （名称、品牌、类目、平台、设备类型、参数、协议、能力、厂家型号、系列、图片、目录类型、单位），
 * **不动客户自己改过的价格、库存、标签、渠道、描述**。
 *
 * 做法上不给「逐字段合并」另写一套写入逻辑，而是复用导入工具的既有约定：
 * 空单元格 = 不改这一项。于是只要把这几列置空，同步就自然变成"只更新官方字段"。
 * 成本价那一列另有 stripCostColumn 处理（成本根本不外发）。
 */
const LOCAL_OWNED_COLUMNS = ["售价", "库存", "标签", "渠道", "描述", "价格核验状态", "价格依据"]

export function stripLocalOwnedColumns(csv: string): string {
  const rows = parseCsv(csv)
  if (!rows.length) return csv
  const indexes = rows[0]
    .map((header, position) => ({ header: header.trim(), position }))
    .filter((entry) => LOCAL_OWNED_COLUMNS.includes(entry.header))
    .map((entry) => entry.position)
  if (!indexes.length) return csv
  const blank = (row: string[]) => row.map((value, position) => (indexes.includes(position) ? "" : cell(value))).join(",")
  return rows.map((row, position) => (position === 0 ? row.join(",") : blank(row))).join("\n")
}
