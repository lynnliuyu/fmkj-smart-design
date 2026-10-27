import type { AdminProduct } from "./product-admin-service"
import { normalizeProductCategory } from "./product-categories"
import { findDeviceType, validateDeviceSpecs, type DeviceSpecs } from "./device-types"
import { PRODUCT_PLATFORM_LABELS, normalizeProductPlatforms } from "./product-platforms"

/**
 * 产品库表格导入的解析与预演（纯函数，不碰数据库）。
 *
 * 为什么要有「预演」这一步：客户的表格是 Excel 手工维护的，一定有漏填、串列、文字数字混用。
 * 先算出「这一行会新增 / 会覆盖哪几个字段 / 哪里有错」，让操作者确认后才写库，
 * 比直接批量覆盖安全得多——写库走的是既有产品写入服务，不另开一条绕过校验的通道。
 *
 * 约定（都在页面上写给操作者看）：
 *   - 空单元格 = **不改这一项**，不是清空。要清空请在后台里改。
 *   - 多个值（标签、渠道）在一个格子里用分号隔开。
 *   - 以系统货号（sku）认人：没有的建新的，已有的按列覆盖。
 */

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024

export type ImportField =
  | "sku" | "name" | "brand" | "platform" | "category" | "deviceTypeId" | "manufacturerModel" | "series"
  | "specs" | "protocols" | "capabilities" | "image"
  | "catalogKind" | "unit" | "price" | "cost" | "stock" | "tags" | "channels" | "description"
  | "selectionStatus" | "selectionEvidence" | "pricingStatus" | "pricingEvidence"

export type ImportColumn = {
  aliases?: string[]
  example: string
  key: ImportField
  label: string
  required?: boolean
}

/** 列顺序就是模板里的列顺序；表头写中文，也认英文键名。 */
export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "sku", label: "系统货号", required: true, example: "FMKJ-SW-001", aliases: ["货号", "SKU编号"] },
  { key: "name", label: "产品名称", required: true, example: "双键智能开关", aliases: ["产品名", "名称"] },
  { key: "brand", label: "品牌", example: "繁梦" },
  { key: "platform", label: "生态平台", example: "米家;Apple Home", aliases: ["支持平台"] },
  { key: "category", label: "产品大类", example: "开关" },
  { key: "deviceTypeId", label: "设备类型ID", example: "wall-switch" },
  { key: "specs", label: "参数", example: "button_count=2;relay_count=1;wiring=neutral", aliases: ["结构化参数", "规格"] },
  { key: "protocols", label: "通信协议", example: "zigbee" },
  { key: "capabilities", label: "设备能力", example: "load-control" },
  { key: "image", label: "图片地址", example: "/placeholder.svg", aliases: ["图片", "商品图"] },
  { key: "manufacturerModel", label: "厂家型号", example: "SW-2K-W" },
  { key: "series", label: "系列", example: "D1", aliases: ["产品系列"] },
  { key: "catalogKind", label: "目录类型", example: "sku" },
  { key: "unit", label: "单位", example: "个", aliases: ["计价单位"] },
  { key: "price", label: "售价", example: "199", aliases: ["价格", "销售价"] },
  { key: "cost", label: "成本", example: "120", aliases: ["成本价", "进价"] },
  { key: "stock", label: "库存", example: "10", aliases: ["库存数量"] },
  { key: "tags", label: "标签", example: "开关;白色" },
  { key: "channels", label: "渠道", example: "线下" },
  { key: "description", label: "描述", example: "" },
  { key: "selectionStatus", label: "参数核验状态", example: "pending" },
  { key: "selectionEvidence", label: "参数依据", example: "" },
  { key: "pricingStatus", label: "价格核验状态", example: "pending" },
  { key: "pricingEvidence", label: "价格依据", example: "" },
]

export type ImportValues = {
  brand?: string
  capabilities?: string[]
  image?: string
  protocols?: string[]
  specs?: DeviceSpecs
  catalogKind?: "legacy" | "series" | "sku"
  category?: string
  channels?: string[]
  cost?: number
  description?: string
  deviceTypeId?: string
  manufacturerModel?: string
  series?: string
  name?: string
  platform?: string
  price?: number
  pricingEvidence?: string
  pricingStatus?: "pending" | "verified" | "conflict"
  selectionEvidence?: string
  selectionStatus?: "pending" | "verified" | "conflict"
  stock?: number
  tags?: string[]
  unit?: string
}

export type ImportRecord = {
  errors: string[]
  line: number
  name: string
  sku: string
  values: ImportValues
}

export type ImportParseResult = {
  /** 整个文件级别的错误：没表头、超过行数上限等；有它就不必看 records。 */
  fileError: string | null
  records: ImportRecord[]
  unknownHeaders: string[]
}

export type ImportChange = { from: string; label: string; to: string }
export type ImportAction = "create" | "update" | "unchanged" | "error"

export type ImportPlanRow = {
  action: ImportAction
  changes: ImportChange[]
  line: number
  message: string
  name: string
  productId: string | null
  sku: string
}

export type ImportPlan = {
  rows: ImportPlanRow[]
  summary: { create: number; error: number; total: number; unchanged: number; update: number }
}

/** RFC4180 风格：支持引号包裹、字段内逗号与换行、双引号转义、CRLF 和 UTF-8 BOM。 */
export function parseCsv(text: string): string[][] {
  const clean = String(text ?? "").replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (quoted) {
      if (char !== '"') { field += char; continue }
      if (clean[index + 1] === '"') { field += '"'; index += 1; continue }
      quoted = false
      continue
    }
    if (char === '"' && field === "") { quoted = true; continue }
    if (char === ",") { row.push(field); field = ""; continue }
    if (char === "\r") continue
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue }
    field += char
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row) }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""))
}

function normalizeHeader(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, "").toLowerCase()
}

/** 表头匹配表：中文标签、英文键名、常见别名都认。 */
function headerIndex(): Map<string, ImportField> {
  const index = new Map<string, ImportField>()
  for (const column of IMPORT_COLUMNS) {
    for (const name of [column.label, column.key, ...(column.aliases ?? [])]) {
      index.set(normalizeHeader(name), column.key)
    }
  }
  return index
}

/** `¥1,299.00`、全角逗号也接受；不是数字就返回 null，由调用方报错。 */
export function parseImportNumber(value: string): number | null {
  const cleaned = String(value ?? "").replace(/[¥￥$,\s，]/g, "")
  if (cleaned === "") return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/** `button_count=2;relay_count=1;wiring=neutral` → { button_count: 2, relay_count: 1, wiring: "neutral" } */
export function parseSpecsCell(value: string): { errors: string[]; specs: DeviceSpecs } {
  const specs: DeviceSpecs = {}
  const errors: string[] = []
  for (const pair of String(value ?? "").split(/[;；]/)) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) { errors.push(`参数「${trimmed}」要写成 名称=值`); continue }
    const key = trimmed.slice(0, index).trim()
    const raw = trimmed.slice(index + 1).trim()
    if (!key) { errors.push(`参数「${trimmed}」缺少名称`); continue }
    if (raw === "") { errors.push(`参数 ${key} 没有填值`); continue }
    specs[key] = coerceSpecValue(raw)
  }
  return { errors, specs }
}

/** 数字写成数字、true/false 写成布尔，其余保持文字——最终由设备类型的定义再校验一遍。 */
function coerceSpecValue(raw: string): string | number | boolean {
  if (raw === "true") return true
  if (raw === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

function splitList(value: string): string[] {
  return String(value ?? "").split(/[;；|]/).map((item) => item.trim()).filter(Boolean)
}

const CATALOG_KINDS = ["legacy", "series", "sku"]
const VERIFY_STATUSES = ["pending", "verified", "conflict"]

export function parseImportTable(text: string): ImportParseResult {
  const bytes = Buffer.byteLength(String(text ?? ""), "utf8")
  if (bytes > IMPORT_MAX_BYTES) {
    return { fileError: `文件超过 ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB，请拆成几个小文件`, records: [], unknownHeaders: [] }
  }

  const table = parseCsv(text)
  if (!table.length) return { fileError: "文件是空的", records: [], unknownHeaders: [] }
  if (table.length - 1 > IMPORT_MAX_ROWS) {
    return { fileError: `一次最多导入 ${IMPORT_MAX_ROWS} 行，请拆成几个小文件`, records: [], unknownHeaders: [] }
  }

  const index = headerIndex()
  const columns = table[0].map((cell) => index.get(normalizeHeader(cell)) ?? null)
  if (!columns.includes("sku") || !columns.includes("name")) {
    return { fileError: "表头里必须有「系统货号」和「产品名称」两列，请用下载的模板", records: [], unknownHeaders: [] }
  }
  const unknownHeaders = table[0].filter((cell, position) => cell.trim() && columns[position] === null).map((cell) => cell.trim())

  const records: ImportRecord[] = []
  const seen = new Map<string, number>()
  for (let position = 1; position < table.length; position += 1) {
    const cells = table[position]
    const line = position + 1
    const raw = new Map<ImportField, string>()
    columns.forEach((key, column) => {
      if (key) raw.set(key, (cells[column] ?? "").trim())
    })

    const record: ImportRecord = { errors: [], line, name: raw.get("name") ?? "", sku: raw.get("sku") ?? "", values: {} }
    if (!record.sku) record.errors.push("系统货号不能为空")
    if (!record.name) record.errors.push("产品名称不能为空")
    const duplicated = record.sku ? seen.get(record.sku) : undefined
    if (duplicated !== undefined) record.errors.push(`系统货号与第 ${duplicated} 行重复`)
    else if (record.sku) seen.set(record.sku, line)

    const text = (key: ImportField): string | undefined => {
      const value = raw.get(key)
      return value ? value : undefined
    }
    const number = (key: ImportField, label: string, integer = false): number | undefined => {
      const value = raw.get(key)
      if (!value) return undefined
      const parsed = parseImportNumber(value)
      if (parsed === null) { record.errors.push(`${label}：请填数字（不要写单位或文字）`); return undefined }
      if (parsed < 0) { record.errors.push(`${label}：不能是负数`); return undefined }
      if (integer && !Number.isInteger(parsed)) { record.errors.push(`${label}：必须是整数`); return undefined }
      return parsed
    }
    const enumValue = <T extends string>(key: ImportField, label: string, allowed: string[]): T | undefined => {
      const value = text(key)
      if (value === undefined) return undefined
      if (!allowed.includes(value)) { record.errors.push(`${label}：只能是 ${allowed.join(" / ")}`); return undefined }
      return value as T
    }

    record.values.brand = text("brand")
    // 生态平台是多值：分号/顿号分隔，写法按 product-platforms 归一（米家→mijia…）。
    const platformCell = text("platform")
    if (platformCell !== undefined) {
      const normalized = normalizeProductPlatforms(platformCell)
      if (normalized.unknown.length) {
        record.errors.push(`生态平台：不认识 ${normalized.unknown.join("、")}（可用：米家、Apple Home、华为、Tuya、KNX、Amazon Alexa、Google Home、未标注）`)
      }
      // 存中文标签（与库里 platform 列、界面显示一致）：预演才不会虚报「米家 → mijia」这种改动。
      // 写入时 product-import-service 会再归一成记号存进 platforms 数组。
      record.values.platform = normalized.values.map((value) => PRODUCT_PLATFORM_LABELS[value] ?? value).join(";")
    }
    record.values.category = text("category")
    record.values.manufacturerModel = text("manufacturerModel")
    record.values.series = text("series")
    record.values.unit = text("unit")
    record.values.description = text("description")
    record.values.selectionEvidence = text("selectionEvidence")
    record.values.pricingEvidence = text("pricingEvidence")
    record.values.tags = raw.get("tags") ? splitList(raw.get("tags") ?? "") : undefined
    record.values.channels = raw.get("channels") ? splitList(raw.get("channels") ?? "") : undefined
    record.values.price = number("price", "售价")
    record.values.cost = number("cost", "成本")
    record.values.stock = number("stock", "库存", true)
    record.values.catalogKind = enumValue("catalogKind", "目录类型", CATALOG_KINDS)
    record.values.selectionStatus = enumValue("selectionStatus", "参数核验状态", VERIFY_STATUSES)
    record.values.pricingStatus = enumValue("pricingStatus", "价格核验状态", VERIFY_STATUSES)

    const deviceTypeId = text("deviceTypeId")
    let validDeviceType = false
    if (deviceTypeId !== undefined) {
      if (findDeviceType(deviceTypeId)) { record.values.deviceTypeId = deviceTypeId; validDeviceType = true }
      else record.errors.push(`设备类型ID「${deviceTypeId}」不存在，请用后台新建产品里的下拉里的值`)
    }

    record.values.protocols = raw.get("protocols") ? splitList(raw.get("protocols") ?? "") : undefined
    record.values.capabilities = raw.get("capabilities") ? splitList(raw.get("capabilities") ?? "") : undefined
    record.values.image = text("image")

    // 结构化参数必须和设备类型一起填：没有类型就无从判断这个参数合不合法。
    const specsCell = text("specs")
    if (specsCell !== undefined) {
      const parsed = parseSpecsCell(specsCell)
      record.errors.push(...parsed.errors)
      if (!validDeviceType) {
        record.errors.push("填了参数就必须同时填设备类型ID，否则无法校验参数")
      } else {
        const checked = validateDeviceSpecs(deviceTypeId, parsed.specs)
        record.errors.push(...checked.errors)
        if (!checked.errors.length) record.values.specs = checked.specs
      }
    }

    records.push(record)
  }

  return { fileError: null, records, unknownHeaders }
}

/** 参数对象的稳定写法：键排序后再比，避免键顺序不同被当成「有变化」。 */
function stableJson(value: DeviceSpecs): string {
  return JSON.stringify(value, Object.keys(value).sort())
}

function describeSpecs(value: DeviceSpecs): string {
  return Object.entries(value).map(([key, entry]) => `${key}=${String(entry)}`).join(";")
}

function sameList(left: string[] | undefined, right: string[]): boolean {
  if (left === undefined) return true
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * 逐个字段比对「表格里写了的值」和「库里现在的值」。
 * 只比对表格里出现的列：没写的列一律不动，这是「空单元格 = 不改」这条约定的落点。
 */
export function diffRecord(record: ImportRecord, existing: AdminProduct): ImportChange[] {
  const values = record.values
  const changes: ImportChange[] = []
  const text = (label: string, next: string | undefined, current: string | null) => {
    if (next === undefined) return
    if (next !== (current ?? "")) changes.push({ from: current ?? "", label, to: next })
  }
  const numeric = (label: string, next: number | undefined, current: number) => {
    if (next === undefined || next === current) return
    changes.push({ from: String(current), label, to: String(next) })
  }

  text("产品名称", values.name ?? record.name, existing.name)
  text("品牌", values.brand, existing.brand)
  text("生态平台", values.platform, existing.platform)
  if (values.category !== undefined) {
    const normalized = normalizeProductCategory(values.category, record.name, values.brand, values.platform, values.description, record.sku)
    if (normalized !== (existing.category ?? "")) changes.push({ from: existing.category ?? "", label: "产品大类", to: normalized })
  }
  text("设备类型ID", values.deviceTypeId, existing.deviceTypeId)
  text("厂家型号", values.manufacturerModel, existing.manufacturerModel)
  // 系列也要比：漏了它，官方改了系列却永远下发不下去（改完被判「和库里一样」跳过）。
  text("系列", values.series, existing.series ?? null)
  text("图片地址", values.image, existing.image)
  text("目录类型", values.catalogKind, existing.catalogKind)
  text("单位", values.unit, existing.unit)
  text("描述", values.description, existing.description)
  text("参数核验状态", values.selectionStatus, existing.selectionStatus)
  text("参数依据", values.selectionEvidence, existing.selectionEvidence)
  text("价格核验状态", values.pricingStatus, existing.pricingStatus)
  text("价格依据", values.pricingEvidence, existing.pricingEvidence)
  numeric("售价", values.price, existing.price)
  numeric("成本", values.cost, existing.cost)
  numeric("库存", values.stock, existing.stock)
  if (values.specs !== undefined && stableJson(values.specs) !== stableJson(existing.specs)) {
    changes.push({ from: describeSpecs(existing.specs), label: "参数", to: describeSpecs(values.specs) })
  }
  if (!sameList(values.protocols, existing.protocols)) changes.push({ from: existing.protocols.join(";"), label: "通信协议", to: (values.protocols ?? []).join(";") })
  if (!sameList(values.capabilities, existing.capabilities)) changes.push({ from: existing.capabilities.join(";"), label: "设备能力", to: (values.capabilities ?? []).join(";") })
  if (!sameList(values.tags, existing.tags)) changes.push({ from: existing.tags.join(";"), label: "标签", to: (values.tags ?? []).join(";") })
  if (!sameList(values.channels, existing.channels)) changes.push({ from: existing.channels.join(";"), label: "渠道", to: (values.channels ?? []).join(";") })

  return changes
}

/** 预演：每一行是新增、覆盖、没变化还是有问题。不写库。 */
export function planProductImport(records: ImportRecord[], existing: AdminProduct[]): ImportPlan {
  const bySku = new Map(existing.map((product) => [product.sku, product]))
  const rows: ImportPlanRow[] = records.map((record) => {
    const base = { line: record.line, name: record.name, sku: record.sku }
    if (record.errors.length) {
      return { ...base, action: "error" as const, changes: [], message: record.errors.join("；"), productId: null }
    }
    const match = bySku.get(record.sku)
    if (!match) {
      return { ...base, action: "create" as const, changes: [], message: "库里没有这个货号，会新建", productId: null }
    }
    const changes = diffRecord(record, match)
    if (!changes.length) {
      return { ...base, action: "unchanged" as const, changes: [], message: "和库里完全一样，会跳过", productId: match.id }
    }
    return { ...base, action: "update" as const, changes, message: `会覆盖 ${changes.length} 项`, productId: match.id }
  })

  return {
    rows,
    summary: {
      create: rows.filter((row) => row.action === "create").length,
      error: rows.filter((row) => row.action === "error").length,
      total: rows.length,
      unchanged: rows.filter((row) => row.action === "unchanged").length,
      update: rows.filter((row) => row.action === "update").length,
    },
  }
}

/** 模板：表头 + 一行示例。示例行故意留一个空列，用来演示「空 = 不改」。 */
export function buildImportTemplate(): string {
  const header = IMPORT_COLUMNS.map((column) => column.label)
  const example = IMPORT_COLUMNS.map((column) => column.example)
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return [header, example].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n"
}
