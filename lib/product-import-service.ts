import {
  createAdminProduct,
  listAdminProducts,
  updateAdminProduct,
  type AdminProduct,
  type ProductMutationInput,
} from "./product-admin-service"
import {
  diffRecord,
  parseImportTable,
  planProductImport,
  type ImportPlan,
  type ImportRecord,
} from "./product-import"
import { normalizeProductPlatforms } from "./product-platforms"
import { checkDictionaryMembership, type ProductDictionaries } from "./product-dictionaries"
import { LOCAL_FILE_PREFIX, localFileExists } from "./file-storage"

/**
 * 产品库表格导入：预演与落库。
 *
 * 两个硬约束，都来自 `docs/product-catalog-agent-guide.md`：
 *   1. 写库只能走 `createAdminProduct` / `updateAdminProduct`——它们负责参数校验、报价快照冻结、
 *      审计日志和映射版本；不新建一条绕过校验的批量直写 SQL。
 *   2. 更新接口不是安全局部更新：漏填的价格/成本会写成 0。所以每行都先读出库里的完整记录，
 *      用「表格里写了的值」覆盖「读到的值」，再整条提交。
 */

export type ImportServiceDependencies = {
  create?: typeof createAdminProduct
  list?: typeof listAdminProducts
  /** 判断本机存储里有没有这张图（默认查真实存储；测试可注入）。 */
  localFileExists?: (url: string) => Promise<boolean>
  update?: typeof updateAdminProduct
}

export type ImportPreview = ImportPlan & {
  fileError: string | null
  unknownHeaders: string[]
}

export type ImportApplyRow = { line: number; message: string; name: string; sku: string; status: "created" | "updated" | "failed" | "skipped" }
export type ImportApplyResult = {
  created: number
  failed: number
  fileError: string | null
  rows: ImportApplyRow[]
  skipped: number
  updated: number
}

/** 资料里的图片是站内路径：`/assets/...`（主站 public）或 `/api/files/...`（主站上传卷）。 */
function isCatalogImagePath(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/assets/") || value.startsWith(LOCAL_FILE_PREFIX))
}

/** 本机存储里是否已经有这张图——决定「已取过」还是「还要再取」。 */
async function existsLocally(url: string, dependencies: ImportServiceDependencies): Promise<boolean> {
  try {
    return await (dependencies.localFileExists ?? localFileExists)(url)
  } catch {
    return false
  }
}

async function loadProducts(dependencies: ImportServiceDependencies): Promise<AdminProduct[]> {
  return await (dependencies.list ?? listAdminProducts)(null)
}

export async function previewProductImport(
  csv: string,
  dependencies: ImportServiceDependencies = {},
): Promise<ImportPreview> {
  const parsed = parseImportTable(csv)
  if (parsed.fileError) {
    return {
      fileError: parsed.fileError,
      rows: [],
      summary: { create: 0, error: 0, total: 0, unchanged: 0, update: 0 },
      unknownHeaders: parsed.unknownHeaders,
    }
  }
  return { ...planProductImport(parsed.records, await loadProducts(dependencies)), fileError: null, unknownHeaders: parsed.unknownHeaders }
}

/**
 * 把一行表格变成创建/更新请求体。
 *
 * 关键点：`existing` 存在时，没在表格里出现的列一律沿用库里的值。价格没写就是原价，
 * 不是 0——这正是后台 PATCH 接口最容易踩的坑。
 */
export function buildMutationInput(
  record: ImportRecord,
  existing: AdminProduct | null,
): ProductMutationInput & { productId?: string } {
  const values = record.values
  const provided = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value)

  return {
    brand: provided(values.brand, existing?.brand ?? null),
    category: provided(values.category, existing?.category ?? null),
    channels: provided(values.channels, existing?.channels ?? []),
    cost: provided(values.cost, existing?.cost ?? 0),
    description: provided(values.description, existing?.description ?? null),
    image: provided(values.image, existing?.image ?? null),
    name: record.name,
    // 表格里的生态平台是分号分隔的多值；写入服务会派生出「首选平台」存进 platform 列。
    platforms: values.platform === undefined ? undefined : normalizeProductPlatforms(values.platform).values,
    platform: provided(values.platform, existing?.platform ?? null),
    series: provided(values.series, existing?.series ?? null),
    price: provided(values.price, existing?.price ?? 0),
    sku: record.sku,
    stock: provided(values.stock, existing?.stock ?? 0),
    tags: provided(values.tags, existing?.tags ?? []),
    unit: provided(values.unit, existing?.unit ?? "个"),
    // 选型字段只在表格里写了才提交：没写的不能替对方决策，也不能抹掉已核验的依据。
    ...(values.catalogKind === undefined ? (existing ? {} : { catalogKind: "legacy" as const }) : { catalogKind: values.catalogKind }),
    ...(values.deviceTypeId === undefined ? {} : { deviceTypeId: values.deviceTypeId }),
    ...(values.manufacturerModel === undefined ? {} : { manufacturerModel: values.manufacturerModel }),
    ...(values.specs === undefined ? {} : { specs: values.specs }),
    ...(values.protocols === undefined ? {} : { protocols: values.protocols }),
    ...(values.capabilities === undefined ? {} : { capabilities: values.capabilities }),
    ...(values.selectionStatus === undefined ? {} : { selectionStatus: values.selectionStatus }),
    ...(values.selectionEvidence === undefined ? {} : { selectionEvidence: values.selectionEvidence }),
    ...(values.pricingStatus === undefined ? {} : { pricingStatus: values.pricingStatus }),
    ...(values.pricingEvidence === undefined ? {} : { pricingEvidence: values.pricingEvidence }),
    ...(existing ? { productId: existing.id } : { status: "pending_review" as const }),
  }
}

/**
 * 已有货号怎么处理：
 *   update —— 按表格覆盖（导入文件时用这条：管理员已经看过逐字段差异并确认）
 *   skip   —— 只补新品，已有的一律不动（手工导入防误覆盖时用；官方同步已改走「部分更新」，见 catalog-sync-service）
 */
export type ExistingProductPolicy = "skip" | "update"

/**
 * 把资料里的站内图片路径换成本地可读地址。
 * 返回 null 表示这次没取到（例如超出本次预算或下载失败），保留原值并记一行说明。
 */
export type AssetResolver = (path: string, existingImage?: string | null) => Promise<string | null>

/**
 * 落库。逐行处理，一行失败不影响其它行——客户表格里错一行不该让整批白做。
 * 产品列表只读一次，之后用写入返回值就地更新，避免每行一次全表查询。
 */
export async function applyProductImport(
  csv: string,
  actorUserId: string | null,
  dependencies: ImportServiceDependencies = {},
  options: { dictionaries?: ProductDictionaries; existing?: ExistingProductPolicy; resolveAsset?: AssetResolver } = {},
): Promise<ImportApplyResult> {
  const parsed = parseImportTable(csv)
  if (parsed.fileError) {
    return { created: 0, failed: 0, fileError: parsed.fileError, rows: [], skipped: 0, updated: 0 }
  }

  const policy: ExistingProductPolicy = options.existing ?? "update"
  const rows: ImportApplyRow[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  const bySku = new Map((await loadProducts(dependencies)).map((product) => [product.sku, product]))
  // 品牌/型号必须来自字典（严格模式）：整批只读一次。
  // 只在调用方注入字典时才校验（手动导入走严格校验；官方资料同步以运营方为准，不校验本地字典）。
  const dictionaries = options.dictionaries ?? null
  const imagePending: number[] = []

  for (const record of parsed.records) {
    const base = { line: record.line, name: record.name, sku: record.sku }
    if (record.errors.length) {
      rows.push({ ...base, status: "failed", message: record.errors.join("；") })
      continue
    }

    // 字典校验：品牌/型号不在字典里就整行失败，并说清是哪个值——否则字典很快又会被写乱。
      const dictionaryProblems = dictionaries ? checkDictionaryMembership(dictionaries, {
      brand: record.values.brand,
      model: record.values.manufacturerModel,
    }) : []
    if (dictionaryProblems.length) {
      rows.push({ ...base, status: "failed", message: dictionaryProblems.join("；") })
      continue
    }

    const existing = bySku.get(record.sku) ?? null
    if (existing && policy === "skip") {
      skipped += 1
      rows.push({ ...base, status: "skipped", message: "本地已有这个货号，本次只新增，不覆盖" })
      continue
    }
    // 官方图片必须先落地，**再**判断「这一行有没有变化」。
    // 顺序反了有个补不回来的坑：图片地址没变 → 整行被当成「和库里一样」跳过 →
    // 首次同步没取完的图（有每次上限）就再也不会去取，客户那边永远破图。
    const remoteImage = options.resolveAsset && isCatalogImagePath(record.values.image) ? record.values.image : null
    if (remoteImage) {
      const localPath = existing?.image?.startsWith(LOCAL_FILE_PREFIX) ? existing.image : null
      const alreadyHere = localPath && await existsLocally(localPath, dependencies)
      const resolved = alreadyHere ? localPath : await options.resolveAsset!(remoteImage, existing?.image ?? null)
      if (resolved) record.values.image = resolved
      else { imagePending.push(record.line); record.values.image = remoteImage }
    }

    if (existing && !diffRecord(record, existing).length) {
      skipped += 1
      rows.push({ ...base, status: "skipped", message: "和库里完全一样，已跳过" })
      continue
    }

    try {
      const input = buildMutationInput(record, existing)
      const product = existing
        ? await (dependencies.update ?? updateAdminProduct)({ ...input, actorUserId, productId: existing.id })
        : await (dependencies.create ?? createAdminProduct)({ ...input, actorUserId })
      bySku.set(product.sku, product)
      if (existing) updated += 1
      else created += 1
      const pendingNote = imagePending.includes(record.line) ? "；图片这次没取到，下次同步继续" : ""
      rows.push({ ...base, status: existing ? "updated" : "created", message: (existing ? "已更新" : "已新增（待审核）") + pendingNote, name: product.name })
    } catch (error) {
      rows.push({ ...base, status: "failed", message: describeError(error) })
    }
  }

  return {
    created,
    failed: rows.filter((row) => row.status === "failed").length,
    fileError: null,
    rows,
    skipped,
    updated,
  }
}

/** 把写入服务的校验错误摊平成一句人话；其它异常只留信息，不带堆栈。 */
function describeError(error: unknown): string {
  const details = (error as { details?: Record<string, string> })?.details
  if (details && typeof details === "object") {
    const parts = Object.values(details).map(String).filter(Boolean)
    if (parts.length) return parts.join("；")
  }
  return error instanceof Error ? error.message : String(error)
}
