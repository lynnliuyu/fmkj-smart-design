import { basename } from "node:path"

import { catalogRevision, catalogSyncConfig, catalogSyncReady, fetchCatalogAsset, fetchCatalogSnapshot, stripCostColumn, stripLocalOwnedColumns, type CatalogSyncConfig } from "./catalog-sync"
import { fileStorage } from "./file-storage"
import type { AssetResolver } from "./product-import-service"
import { applyProductImport, previewProductImport, type ImportApplyResult, type ImportPreview } from "./product-import-service"
import { getPool } from "./server-db"
import { syncDictionariesFromProducts } from "./product-dictionaries"

/**
 * 官方产品资料同步的服务层。
 *
 * 三件事必须成立（合同要求，也是设备场景的底线）：
 *   1. 连不上、凭据过期、摘要不对 —— 一律不动本地资料，游标不前进。
 *   2. 同步只走批量导入那条通道，因此复用同一套校验、审计与版本规则，不重复建产品。
 *   3. 每次同步都留一条运行记录（含失败），供管理员页面查看。
 */

export type CatalogSyncLastRun = {
  created: number
  signature: string
  failed: number
  finishedAt: string | null
  message: string
  revision: string
  skipped: number
  startedAt: string
  status: string
  updated: number
}

export type CatalogSyncStatus = {
  baseUrl: string
  configured: boolean
  enabled: boolean
  lastRun: CatalogSyncLastRun | null
}

/** 一次同步最多下多少张图：800 个产品一次性拉完太慢，分批补齐更稳。 */
export const ASSET_BUDGET_PER_RUN = 600

export type AssetResolverDependencies = {
  budget?: number
  fetch?: typeof fetch
  save?: (input: { bytes: Uint8Array; contentType: string; filename: string; kind: string; ownerId: string }) => Promise<{ url: string }>
}

/**
 * 把官方图片取回本地存储，返回本地可读地址。
 * 超出本次预算或下载失败都返回 null：调用方保留原路径并记一行「下次继续」，
 * 不让一个图片拖垮整条同步。
 */
export function createAssetResolver(config: CatalogSyncConfig, dependencies: AssetResolverDependencies = {}) {
  const budget = dependencies.budget ?? ASSET_BUDGET_PER_RUN
  const save = dependencies.save ?? ((input) => fileStorage().save(input as never))
  let used = 0
  const failed: string[] = []

  const resolve: AssetResolver = async (path) => {
    if (used >= budget) return null
    used += 1
    try {
      const asset = await fetchCatalogAsset(config, path, { fetch: dependencies.fetch })
      const stored = await save({
        bytes: new Uint8Array(asset.bytes),
        contentType: asset.contentType,
        filename: basename(path),
        kind: "product-images",
        ownerId: "official",
      })
      return stored.url
    } catch {
      failed.push(path)
      return null
    }
  }

  return { resolve, used: () => used, failed: () => failed.slice() }
}

export type CatalogSyncDependencies = {
  apply?: typeof applyProductImport
  /** 读本机产品（字典补齐用；测试可注入）。 */
  listProducts?: () => Promise<Array<{ brand?: string | null; manufacturerModel?: string | null; series?: string | null }>>
  db?: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  preview?: typeof previewProductImport
}

/** 读本机产品（字典补齐用）。直接用管理侧的产品列表，规则一致。 */
async function listLocalProducts() {
  const { listAdminProducts } = await import("./product-admin-service")
  return (await listAdminProducts(null)).map((product) => ({
    brand: product.brand,
    manufacturerModel: product.manufacturerModel,
    series: product.series ?? null,
  }))
}

function pool(dependencies: CatalogSyncDependencies) {
  return dependencies.db ?? getPool()
}

export async function getCatalogSyncStatus(dependencies: CatalogSyncDependencies = {}): Promise<CatalogSyncStatus> {
  const config = catalogSyncConfig(dependencies.env ?? process.env)
  let lastRun: CatalogSyncLastRun | null = null

  try {
    const result = await pool(dependencies).query(
      `select revision, status, created_count, updated_count, skipped_count, failed_count, message, signature, started_at, finished_at
       from catalog_sync_runs order by started_at desc limit 1`,
    )
    const row = result.rows[0]
    if (row) {
      lastRun = {
        created: Number(row.created_count ?? 0),
        failed: Number(row.failed_count ?? 0),
        finishedAt: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
        message: String(row.message ?? ""),
        revision: String(row.revision ?? ""),
        signature: String(row.signature ?? ""),
        skipped: Number(row.skipped_count ?? 0),
        startedAt: new Date(row.started_at as string).toISOString(),
        status: String(row.status ?? "unknown"),
        updated: Number(row.updated_count ?? 0),
      }
    }
  } catch {
    // 还没跑过迁移、或数据库暂时不可用：页面显示「还没有同步记录」，不影响其它功能。
    lastRun = null
  }

  return {
    baseUrl: config.baseUrl,
    configured: catalogSyncReady(config),
    enabled: config.enabled,
    lastRun,
  }
}

/** 统一的「没配好」提示：告诉设备管理员要设哪几个变量。 */
export function catalogSyncNotReady(config: CatalogSyncConfig): string {
  if (!config.enabled) return "这台设备没有开启官方资料同步（UPSTREAM_ENABLED 不是 true）。"
  if (!config.baseUrl) return "缺少 UPSTREAM_BASE_URL：官方资料服务的地址没有配置。"
  if (!config.licenseKey) return "缺少 LICENSE_KEY：没有订阅凭据，无法同步。"
  return "官方资料同步没有配置好。"
}

export type CatalogSyncPreview = {
  message: string
  preview: ImportPreview | null
  revision: string
  signature: string
}

/**
 * 预演也要按同一策略呈现：同步只更新官方字段、不动客户自己的价格/库存/标签/渠道/描述，
 * 否则管理员看到的差异和实际落库结果对不上。
 */
export function applyExistingPolicy(preview: ImportPreview, updateExisting: boolean): ImportPreview {
  if (updateExisting) return preview
  const rows = preview.rows.map((row) => (row.action === "update"
    ? { ...row, action: "unchanged" as const, changes: [], message: "本地已有这个货号，本次不覆盖（要覆盖请勾选下面的选项）" }
    : row))
  return {
    ...preview,
    rows,
    summary: { ...preview.summary, unchanged: preview.summary.unchanged + preview.summary.update, update: 0 },
  }
}

/** 拉一份资料并算出差异，不写库。 */
export async function previewCatalogSync(
  dependencies: CatalogSyncDependencies = {},
  options: { updateExisting?: boolean } = {},
): Promise<CatalogSyncPreview> {
  const config = catalogSyncConfig(dependencies.env ?? process.env)
  if (!catalogSyncReady(config)) {
    return { message: catalogSyncNotReady(config), preview: null, revision: "", signature: "" }
  }

  const snapshot = await fetchCatalogSnapshot(config, { fetch: dependencies.fetch })
  const raw = await (dependencies.preview ?? previewProductImport)(snapshot.csv)
  const signatureNote = snapshot.signature === "verified" ? "资料签名已验证。" : "资料没有签名（未配置公钥）。"
  return {
    message: `${signatureNote}${options.updateExisting ? "" : "默认只补本地没有的新品；已有的货号本次不覆盖。"}`,
    preview: applyExistingPolicy(raw, options.updateExisting === true),
    revision: snapshot.revision,
    signature: snapshot.signature,
  }
}

export type CatalogSyncApply = {
  message: string
  result: ImportApplyResult | null
  revision: string
  signature: string
}

/**
 * 拉最新资料并落库。失败也记一条运行记录：下次打开页面能看到「上次为什么没成功」。
 *
 * `updateExisting` 默认 **false**：只补本地没有的新品，已有的货号一律不碰。
 * 官方资料里的价格未必等于本地调过的价格，默默覆盖是数据事故；要覆盖必须管理员显式选。
 */
export async function applyCatalogSync(
  actorUserId: string | null,
  dependencies: CatalogSyncDependencies = {},
  options: { downloadAssets?: boolean; updateExisting?: boolean } = {},
): Promise<CatalogSyncApply> {
  const config = catalogSyncConfig(dependencies.env ?? process.env)
  if (!catalogSyncReady(config)) {
    return { message: catalogSyncNotReady(config), result: null, revision: "", signature: "" }
  }

  const startedAt = new Date()
  let revision = ""
  try {
    const snapshot = await fetchCatalogSnapshot(config, { fetch: dependencies.fetch })
    revision = snapshot.revision
    // 图片默认一起取：只取资料里出现、本地还没有的那些；每次有预算上限。
    const assets = options.downloadAssets === false ? null : createAssetResolver(config, { fetch: dependencies.fetch })
    // 规则 B：官方同步更新「官方字段」，不动客户自己的价格/库存/标签/渠道/描述。
    // 实现方式是把这些列置空——导入工具的约定是「空单元格 = 不改这一项」。
    const result = await (dependencies.apply ?? applyProductImport)(
      stripLocalOwnedColumns(stripCostColumn(snapshot.csv)),
      actorUserId,
      {},
      {
        existing: "update",
        ...(assets ? { resolveAsset: assets.resolve } : {}),
      },
    )
    const assetNote = assets && assets.used() > 0
      ? `本次下载官方图片 ${assets.used() - assets.failed().length} 张${assets.used() >= ASSET_BUDGET_PER_RUN ? `（已到每次 ${ASSET_BUDGET_PER_RUN} 张上限，其余下次继续）` : ""}。`
      : ""
    // 字典跟着产品一起补齐：同步只发产品，设备上的品牌/系列/型号字典本来是空的，
    // 客户在自己设备上编辑产品时下拉框没有候选值。这里按「只增不改」补齐。
    let dictionaryNote = ""
    try {
      const products = await (dependencies.listProducts?.() ?? listLocalProducts())
      const added = await syncDictionariesFromProducts(products)
      const total = added.brands + added.series + added.models
      if (total > 0) dictionaryNote = `字典补充：品牌 ${added.brands}、系列 ${added.series}、型号 ${added.models}。`
    } catch {
      // 字典补齐失败不该让整次同步算失败：产品已经落地了。
    }
    const message = [result.fileError ?? "", assetNote, dictionaryNote].filter(Boolean).join(" ")
    await recordRun(dependencies, {
      actorUserId,
      revision,
      startedAt,
      status: result.failed ? "partial" : "succeeded",
      result,
      message,
      signature: snapshot.signature,
    })
    return { message, result, revision, signature: snapshot.signature }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordRun(dependencies, {
      actorUserId,
      revision: revision || catalogRevision(""),
      startedAt,
      status: "failed",
      result: null,
      message,
    })
    throw new Error(message)
  }
}

async function recordRun(
  dependencies: CatalogSyncDependencies,
  input: {
    actorUserId: string | null
    message: string
    result: ImportApplyResult | null
    revision: string
    signature?: string
    startedAt: Date
    status: string
  },
) {
  try {
    await pool(dependencies).query(
      `insert into catalog_sync_runs (
         revision, status, created_count, updated_count, skipped_count, failed_count, message,
         actor_user_id, started_at, finished_at, signature
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, now(), $10)`,
      [
        input.revision,
        input.status,
        input.result?.created ?? 0,
        input.result?.updated ?? 0,
        input.result?.skipped ?? 0,
        input.result?.failed ?? 0,
        input.message.slice(0, 1000),
        input.actorUserId,
        input.startedAt.toISOString(),
        input.signature ?? "",
      ],
    )
  } catch {
    // 记录失败不影响同步结果本身：资料已经写进去了，不该因为日志表写不进而报错。
  }
}
