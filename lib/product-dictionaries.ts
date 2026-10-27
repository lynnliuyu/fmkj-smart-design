/**
 * 品牌 / 系列 / 型号受控字典（服务端部分：读写与校验）。
 *
 * 类型与下拉选项在 lib/product-dictionary-types.ts（客户端安全）；
 * 这个文件带数据库访问，只能被服务端代码引用。
 */
import type { DictionaryKind, ProductDictionaries } from "./product-dictionary-types"
import { getPool } from "./server-db"

export type {
  DictionaryKind,
  ProductBrandEntry,
  ProductDictionaries,
  ProductModelEntry,
  ProductSeriesEntry,
} from "./product-dictionary-types"
export { brandNames, dictionaryOptions, modelNames, seriesNames } from "./product-dictionary-types"

type Row = { id: string; name: string; note: string | null; is_active: boolean; brand_name?: string | null; series_name?: string | null }

function mapEntry(row: Row) {
  return { id: row.id, isActive: row.is_active, name: row.name, note: row.note }
}

/** 读取字典（后台管理用：含已停用的；下拉框请自己过滤 isActive）。 */
export async function listProductDictionaries(): Promise<ProductDictionaries> {
  const pool = getPool()
  const [brands, series, models] = await Promise.all([
    pool.query<Row>("select id::text as id, name, note, is_active from product_brands order by name"),
    pool.query<Row>(`
      select s.id::text as id, s.name, s.note, s.is_active, b.name as brand_name
      from product_series s join product_brands b on b.id = s.brand_id
      order by b.name, s.name`),
    pool.query<Row>(`
      select m.id::text as id, m.name, m.note, m.is_active, b.name as brand_name, s.name as series_name
      from product_models m
      join product_brands b on b.id = m.brand_id
      left join product_series s on s.id = m.series_id
      order by b.name, m.name`),
  ])
  return {
    brands: brands.rows.map(mapEntry),
    series: series.rows.map((row) => ({ ...mapEntry(row), brandName: row.brand_name ?? "" })),
    models: models.rows.map((row) => ({ ...mapEntry(row), brandName: row.brand_name ?? "", seriesName: row.series_name ?? null })),
  }
}

/** 让名字大小写/空格差异不误判（「Aqara 」「aqara」算同一个）。 */
function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export class DictionaryError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = "DictionaryError"
  }
}

function cleanName(input: unknown, label: string) {
  const name = String(input ?? "").trim()
  if (!name) throw new DictionaryError(`${label}不能为空`)
  if (name.length > 80) throw new DictionaryError(`${label}最多 80 字`)
  return name
}

async function resolveBrandId(brand: unknown) {
  const name = String(brand ?? "").trim()
  if (!name) throw new DictionaryError("请先选择品牌")
  const result = await getPool().query<{ id: string }>("select id::text as id from product_brands where lower(btrim(name)) = lower($1)", [name])
  const id = result.rows[0]?.id
  if (!id) throw new DictionaryError(`品牌「${name}」还不在字典里，请先新增品牌`)
  return id
}

async function resolveSeriesId(brandId: string, series: unknown) {
  const name = String(series ?? "").trim()
  if (!name) return null
  const result = await getPool().query<{ id: string }>("select id::text as id from product_series where brand_id = $1::uuid and lower(btrim(name)) = lower($2)", [brandId, name])
  const id = result.rows[0]?.id
  if (!id) throw new DictionaryError(`系列「${name}」还不在字典里，请先新增系列`)
  return id
}

export async function createDictionaryEntry(input: { brand?: unknown; kind: DictionaryKind; name?: unknown; series?: unknown }) {
  const pool = getPool()
  const name = cleanName(input.name, input.kind === "brand" ? "品牌名" : input.kind === "series" ? "系列名" : "型号名")
  if (input.kind === "brand") {
    const exists = await pool.query("select 1 from product_brands where lower(btrim(name)) = lower($1)", [name])
    if (exists.rowCount) throw new DictionaryError(`品牌「${name}」已经在字典里了`)
    const created = await pool.query<Row>("insert into product_brands (name) values ($1) returning id::text as id, name, note, is_active", [name])
    return mapEntry(created.rows[0])
  }
  const brandId = await resolveBrandId(input.brand)
  if (input.kind === "series") {
    const exists = await pool.query("select 1 from product_series where brand_id=$1::uuid and lower(btrim(name)) = lower($2)", [brandId, name])
    if (exists.rowCount) throw new DictionaryError(`这个品牌下已经有系列「${name}」了`)
    const created = await pool.query<Row>("insert into product_series (brand_id, name) values ($1::uuid,$2) returning id::text as id, name, note, is_active", [brandId, name])
    return mapEntry(created.rows[0])
  }
  const seriesId = await resolveSeriesId(brandId, input.series)
  const exists = await pool.query("select 1 from product_models where brand_id=$1::uuid and lower(btrim(name)) = lower($2)", [brandId, name])
  if (exists.rowCount) throw new DictionaryError(`这个品牌下已经有型号「${name}」了`)
  const created = await pool.query<Row>("insert into product_models (brand_id, series_id, name) values ($1::uuid,$2::uuid,$3) returning id::text as id, name, note, is_active", [brandId, seriesId, name])
  return mapEntry(created.rows[0])
}

export async function updateDictionaryEntry(input: { id?: unknown; isActive?: unknown; kind: DictionaryKind; name?: unknown }) {
  const id = String(input.id ?? "").trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DictionaryError("字典条目 id 无效")
  const table = input.kind === "brand" ? "product_brands" : input.kind === "series" ? "product_series" : "product_models"
  const sets: string[] = []
  const params: unknown[] = [id]
  if (input.name !== undefined) {
    params.push(cleanName(input.name, "名称"))
    sets.push(`name = $${params.length}`)
  }
  if (input.isActive !== undefined) {
    params.push(Boolean(input.isActive))
    sets.push(`is_active = $${params.length}`)
  }
  if (!sets.length) throw new DictionaryError("没有要修改的内容")
  const updated = await getPool().query<Row>(`update ${table} set ${sets.join(", ")}, updated_at = now() where id = $1::uuid returning id::text as id, name, note, is_active`, params)
  if (!updated.rows[0]) throw new DictionaryError("字典条目不存在", 404)
  return mapEntry(updated.rows[0])
}

/**
 * 导入时校验：品牌/型号必须来自字典（严格模式，用户 2026-10-23 定的）。
 * 空值不算错误——老产品本来就可能还没填。
 */
export function checkDictionaryMembership(
  dictionaries: ProductDictionaries,
  input: { brand?: string | null; model?: string | null },
): string[] {
  const problems: string[] = []
  const brand = String(input.brand ?? "").trim()
  const model = String(input.model ?? "").trim()
  const brandEntry = brand ? dictionaries.brands.find((entry) => sameName(entry.name, brand)) : undefined
  if (brand && !brandEntry) problems.push(`品牌「${brand}」不在字典里`)
  if (model) {
    const known = dictionaries.models.some((entry) => sameName(entry.name, model) && (!brandEntry || sameName(entry.brandName, brandEntry.name)))
    if (!known) problems.push(`型号「${model}」不在字典里${brand ? `（品牌：${brand}）` : ""}`)
  }
  return problems
}

/**
 * 从同步来的产品里收集品牌/系列/型号，补进本机字典。
 *
 * 为什么要有这一步：目录同步只发产品，设备上的品牌/型号字典是空的，
 * 客户在自己设备上编辑产品时，下拉框里没有候选值（只能看到当前值）。
 * 这里按「只增不改」的原则补齐：已有条目不动，不覆盖运营方在设备上手动加的东西。
 */
export async function syncDictionariesFromProducts(
  products: Array<{ brand?: string | null; manufacturerModel?: string | null; series?: string | null }>,
): Promise<{ brands: number; models: number; series: number }> {
  const pool = getPool()
  const brands = new Set<string>()
  const series = new Set<string>()   // "品牌\u0000系列"
  const models = new Set<string>()   // "品牌\u0000型号"
  for (const product of products) {
    const brand = String(product.brand ?? "").trim()
    if (!brand) continue
    brands.add(brand)
    const seriesName = String(product.series ?? "").trim()
    if (seriesName) series.add(`${brand}\u0000${seriesName}`)
    const model = String(product.manufacturerModel ?? "").trim()
    if (model) models.add(`${brand}\u0000${model}`)
  }

  let brandsAdded = 0
  let seriesAdded = 0
  let modelsAdded = 0
  for (const brand of brands) {
    const result = await pool.query("insert into product_brands (name) values ($1) on conflict (name) do nothing", [brand])
    brandsAdded += result.rowCount ?? 0
  }
  for (const item of series) {
    const [brand, name] = item.split("\u0000")
    const result = await pool.query(
      `insert into product_series (brand_id, name)
       select id, $2 from product_brands where name = $1
       on conflict (brand_id, name) do nothing`,
      [brand, name],
    )
    seriesAdded += result.rowCount ?? 0
  }
  for (const item of models) {
    const [brand, name] = item.split("\u0000")
    const result = await pool.query(
      `insert into product_models (brand_id, name)
       select id, $2 from product_brands where name = $1
       on conflict (brand_id, name) do nothing`,
      [brand, name],
    )
    modelsAdded += result.rowCount ?? 0
  }
  return { brands: brandsAdded, models: modelsAdded, series: seriesAdded }
}
