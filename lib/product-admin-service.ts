import type { Pool, PoolClient } from "pg"

import { normalizeProductCategory } from "./product-categories"
import { getPool } from "./server-db"
import { productSelectionWithDefaults, validateProductSelectionFields, type ProductSelectionFields } from "./product-selection"

export type ProductModerationStatus = "pending_review" | "approved" | "rejected" | "inactive" | "active"

export const DEFAULT_PRODUCT_UNIT = "个"

export type AdminProduct = Required<ProductSelectionFields> & {
  selectionReviewedBy: string | null
  selectionReviewedAt: string | null
  brand: string | null
  category: string | null
  channels: string[]
  cost: number
  createdAt: string
  description: string | null
  id: string
  image: string | null
  name: string
  platform: string | null
  price: number
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  sku: string
  status: ProductModerationStatus
  stock: number
  submittedBy: string | null
  tags: string[]
  unit: string
  updatedAt: string
}

type Queryable = Pick<Pool | PoolClient, "query">

export type ProductRow = {
  catalog_kind?: string
  device_type_id?: string | null
  parent_product_id?: string | null
  manufacturer_model?: string | null
  specs?: unknown
  protocols?: unknown
  capabilities?: unknown
  selection_status?: string
  selection_evidence?: string
  selection_reviewed_by?: string | null
  selection_reviewed_at?: Date | string | null
  pricing_status?: string
  pricing_evidence?: string
  mapping_revision?: number
  brand: string | null
  category: string | null
  channels: unknown
  cost: number | string | null
  created_at: Date | string
  description: string | null
  id: string
  image: string | null
  name: string
  platform: string | null
  price: number | string | null
  review_note: string | null
  reviewed_at: Date | string | null
  reviewed_by: string | null
  sku: string
  status: ProductModerationStatus
  stock: number | string | null
  submitted_by: string | null
  tags: unknown
  unit: string | null
  updated_at: Date | string
}

export class ProductValidationError extends Error {
  details: Record<string, string>

  constructor(details: Record<string, string>) {
    super("VALIDATION_ERROR")
    this.name = "ProductValidationError"
    this.details = details
  }
}

export function productValidationErrorResponse(error: unknown) {
  if (error instanceof ProductValidationError) {
    return Response.json(
      { code: "VALIDATION_ERROR", details: error.details, error: "VALIDATION_ERROR" },
      { status: 400 }
    )
  }

  throw error
}

export async function listAdminProducts(status?: string | null) {
  const allowedStatuses = new Set(["pending_review", "approved", "rejected", "inactive", "active"])
  const filter = status && allowedStatuses.has(status) ? status : null
  const result = await getPool().query<ProductRow>(
    `
    ${productSelectSql()}
    where deleted_at is null
      and ($1::text is null or status::text = $1)
    order by
      case status::text
        when 'pending_review' then 0
        when 'rejected' then 2
        when 'approved' then 3
        when 'active' then 4
        else 5
      end,
      updated_at desc
    `,
    [filter]
  )

  return result.rows.map(mapProduct)
}

export async function createAdminProduct(input: ProductMutationInput & { actorUserId: string }) {
  validateProduct(input)
  const selection = prepareProductSelection(input)
  return inProductTransaction(async (db) => {
    await validateParent(db, selection)
    const params = [...productMutationParams(input, input.status ?? "pending_review"), ...selectionParams(selection)]
    const result = await db.query<ProductRow>(`
      insert into products (
        created_by, updated_by, submitted_by, name, brand, platform, category, sku, unit,
        price, cost, stock, image, description, tags, channels, status,
        catalog_kind, device_type_id, parent_product_id, manufacturer_model, specs, protocols, capabilities,
        selection_status, selection_evidence, pricing_status, pricing_evidence, mapping_revision,
        selection_reviewed_by, selection_reviewed_at
      ) values ($1::uuid,$1::uuid,$1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,
        $16,$17,$18::uuid,$19,$20::jsonb,$21::jsonb,$22::jsonb,$23,$24,$25,$26,$27,
        case when $23 = 'verified' then $1::uuid else null end,
        case when $23 = 'verified' then now() else null end)
      returning ${productColumns()}`, params)
    const product = mapProduct(result.rows[0])
    await recordProductActivity(db, { action: "product.created", actorUserId: input.actorUserId,
      description: `创建产品 ${product.name}`, entityId: product.id, entityLabel: product.name, title: "产品已创建" })
    return product
  })
}

export async function updateAdminProduct(input: ProductMutationInput & { actorUserId: string; productId: string }) {
  validateProduct(input)
  return inProductTransaction(async (db) => {
    const before = await lockProduct(db, input.productId)
    if (input.mappingRevision !== undefined && input.mappingRevision !== before.mappingRevision) {
      throw new ProductValidationError({ mappingRevision: "产品已被更新，请刷新后重新审核" })
    }
    const selection = prepareProductSelection(input, before)
    await validateParent(db, selection, input.productId)
    const children = await db.query<{ device_type_id: string | null }>("select device_type_id from products where parent_product_id=$1::uuid and deleted_at is null for update", [input.productId])
    if (children.rows.length && (selection.catalogKind !== "series" || children.rows.some((child) => child.device_type_id && selection.deviceTypeId && child.device_type_id !== selection.deviceTypeId))) {
      throw new ProductValidationError({ catalogKind: "该产品存在子 SKU，请先处理子项后再更改系列或设备类型" })
    }
    await freezeProductQuoteSnapshots(db, input.productId)
    const result = await db.query<ProductRow>(`
      update products set updated_by=$1::uuid, name=$2, brand=$3, platform=$4, category=$5, sku=$6, unit=$7,
        price=$8, cost=$9, stock=$10, image=$11, description=$12, tags=$13::jsonb, channels=$14::jsonb,
        status=coalesce($15,status), catalog_kind=$16, device_type_id=$17, parent_product_id=$18::uuid,
        manufacturer_model=$19, specs=$20::jsonb, protocols=$21::jsonb, capabilities=$22::jsonb,
        selection_status=$23, selection_evidence=$24, pricing_status=$25, pricing_evidence=$26, mapping_revision=$27,
        selection_reviewed_by=case when $23<>'verified' then null when $29 then $1::uuid else selection_reviewed_by end,
        selection_reviewed_at=case when $23<>'verified' then null when $29 then now() else selection_reviewed_at end, updated_at=now()
      where id=$28::uuid and deleted_at is null returning ${productColumns()}`,
      [...productMutationParams(input, input.status ?? null), ...selectionParams(selection), input.productId, selection.selectionStatus === "verified" && (before.selectionStatus !== "verified" || selection.selectionEvidence !== before.selectionEvidence)])
    const product = mapProduct(result.rows[0])
    await recordProductActivity(db, { action: "product.updated", actorUserId: input.actorUserId,
      description: `更新产品 ${product.name}，映射版本 ${product.mappingRevision}`, entityId: product.id,
      entityLabel: product.name, title: "产品已更新" })
    return product
  })
}

export async function reviewAdminProduct(input: {
  actorUserId: string
  note?: string
  productId: string
  status: "approved" | "rejected"
}) {
  const note = String(input.note ?? "").trim()
  if (input.status === "rejected" && !note) {
    throw new ProductValidationError({ reviewNote: "请填写驳回原因" })
  }

  return inProductTransaction(async (db) => {
    const before = await lockProduct(db, input.productId)
    await freezeProductQuoteSnapshots(db, input.productId)
    const result = await db.query<ProductRow>(`
      update products set status=$2, reviewed_by=$3::uuid, reviewed_at=now(), review_note=nullif($4,''),
        updated_by=$3::uuid, updated_at=now(), mapping_revision=mapping_revision + case when status::text <> $2::text then 1 else 0 end
      where id=$1::uuid and deleted_at is null returning ${productColumns()}`,
      [input.productId, input.status, input.actorUserId, note])
    const product = mapProduct(result.rows[0])
    await recordProductActivity(db, { action: input.status === "approved" ? "product.approved" : "product.rejected",
      actorUserId: input.actorUserId, description: `审核产品 ${before.name}：${input.status}${note ? `，${note}` : ""}`,
      entityId: product.id, entityLabel: product.name, title: input.status === "approved" ? "产品已通过" : "产品已驳回" })
    return product
  })
}

export const MAX_BULK_PRODUCT_REVIEW = 500

export type BulkProductReviewTarget = { id: string; mappingRevision: number }

export type BulkProductReviewResult = {
  approved: number
  skipped: number
  products: AdminProduct[]
  skippedProducts: { id: string; status: "approved" | "active"; reason: "already-approved" }[]
}

/** The explicit IDs/revisions represent the administrator's reviewed list, not a server-wide filter. */
export function parseBulkProductReviewInput(input: unknown): { products: BulkProductReviewTarget[]; note: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProductValidationError({ products: "请提交待审核产品列表" })
  }
  const body = input as Record<string, unknown>
  if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > MAX_BULK_PRODUCT_REVIEW) {
    throw new ProductValidationError({ products: `每批请选择 1 至 ${MAX_BULK_PRODUCT_REVIEW} 条产品` })
  }
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.trim().length > 1000)) {
    throw new ProductValidationError({ note: "审核备注须为不超过 1000 字的文字" })
  }
  const products = new Map<string, BulkProductReviewTarget>()
  const details: Record<string, string> = {}
  body.products.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      details[`products.${index}`] = "产品标识与版本无效"
      return
    }
    const target = entry as Record<string, unknown>
    if (typeof target.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.id)) {
      details[`products.${index}`] = "产品标识须为有效 UUID"
      return
    }
    if (typeof target.mappingRevision !== "number" || !Number.isSafeInteger(target.mappingRevision) || target.mappingRevision < 1) {
      details[`products.${index}`] = "请携带产品当前的整数版本"
      return
    }
    const id = target.id.toLowerCase()
    const duplicate = products.get(id)
    if (duplicate && duplicate.mappingRevision !== target.mappingRevision) {
      details[`products.${id}`] = "同一产品存在不同版本，请刷新列表后重试"
      return
    }
    products.set(id, { id, mappingRevision: target.mappingRevision })
  })
  if (Object.keys(details).length) throw new ProductValidationError(details)
  return { products: [...products.values()].sort((left, right) => left.id.localeCompare(right.id)), note: (body.note as string | undefined)?.trim() ?? "" }
}

/** Approves catalog visibility only; selection/pricing verification and all product data stay intact. */
export async function bulkReviewAdminProducts(input: {
  actorUserId: string
  products: unknown
  note?: unknown
}): Promise<BulkProductReviewResult> {
  const targets = parseBulkProductReviewInput(input)
  return inProductTransaction(async (db) => {
    const locked = await db.query<ProductRow>(`
      ${productSelectSql()} where id=any($1::uuid[]) and deleted_at is null order by id for update`,
      [targets.products.map((product) => product.id)])
    const current = new Map(locked.rows.map((row) => [row.id, mapProduct(row)]))
    const pending: AdminProduct[] = []
    const skippedProducts: BulkProductReviewResult["skippedProducts"] = []
    const details: Record<string, string> = {}
    for (const target of targets.products) {
      const product = current.get(target.id)
      if (!product) {
        details[`products.${target.id}`] = "产品不存在或已删除，请刷新列表"
      } else if (product.status === "approved" || product.status === "active") {
        skippedProducts.push({ id: product.id, status: product.status, reason: "already-approved" })
      } else if (product.status !== "pending_review") {
        details[`products.${target.id}`] = "产品已驳回或停用，请刷新后单独处理"
      } else if (product.mappingRevision !== target.mappingRevision) {
        details[`products.${target.id}`] = "产品已被更新，请刷新后重新审核"
      } else pending.push(product)
    }
    // Validate the entire locked set before freezing snapshots or changing any product.
    if (Object.keys(details).length) throw new ProductValidationError(details)
    const products: AdminProduct[] = []
    for (const before of pending) {
      await freezeProductQuoteSnapshots(db, before.id)
      const result = await db.query<ProductRow>(`
        update products set status='approved', reviewed_by=$2::uuid, reviewed_at=now(), review_note=nullif($3,''),
          updated_by=$2::uuid, updated_at=now(), mapping_revision=mapping_revision+1
        where id=$1::uuid and deleted_at is null and status::text='pending_review' returning ${productColumns()}`,
        [before.id, input.actorUserId, targets.note])
      if (!result.rows[0]) throw new ProductValidationError({ [`products.${before.id}`]: "产品状态已变化，请刷新后重新审核" })
      const product = mapProduct(result.rows[0])
      await recordProductActivity(db, {
        action: "product.approved", actorUserId: input.actorUserId,
        description: `批量目录审核通过 ${before.name}${targets.note ? `，${targets.note}` : ""}；规格和价格核验状态保持原值`,
        entityId: product.id, entityLabel: product.name, title: "产品已批量通过",
      })
      products.push(product)
    }
    return { approved: products.length, skipped: skippedProducts.length, products, skippedProducts }
  })
}

export async function deactivateAdminProduct(input: { actorUserId: string; productId: string }) {
  return inProductTransaction(async (db) => {
    await lockProduct(db, input.productId)
    await freezeProductQuoteSnapshots(db, input.productId)
    const result = await db.query<ProductRow>(`
      update products set status='inactive',updated_by=$2::uuid,updated_at=now(),
        mapping_revision=mapping_revision + case when status::text <> 'inactive' then 1 else 0 end
      where id=$1::uuid and deleted_at is null returning ${productColumns()}`, [input.productId,input.actorUserId])
    const product = mapProduct(result.rows[0])
    await recordProductActivity(db, { action: "product.deactivated", actorUserId: input.actorUserId,
      description: `停用产品 ${product.name}`, entityId: product.id, entityLabel: product.name, title: "产品已停用" })
    return product
  })
}

export type ProductMutationInput = Partial<ProductSelectionFields> & {
  brand?: string | null
  category?: string | null
  channels?: string[]
  cost?: number
  description?: string | null
  image?: string | null
  name: string
  platform?: string | null
  price?: number
  sku: string
  status?: ProductModerationStatus | null
  stock?: number
  tags?: string[]
  unit?: string
}

function productSelectSql() {
  return `select ${productColumns()} from products`
}

export function productColumns() {
  return `
    id::text,
    name,
    brand,
    platform,
    category,
    sku,
    unit,
    price::float8,
    cost::float8,
    stock::int,
    image,
    description,
    coalesce(tags, '[]'::jsonb) as tags,
    coalesce(channels, '[]'::jsonb) as channels,
    status,
    submitted_by::text,
    reviewed_by::text,
    reviewed_at,
    review_note,
    created_at,
    updated_at,
    catalog_kind, device_type_id, parent_product_id::text, manufacturer_model, specs, protocols, capabilities,
    selection_status, selection_evidence, selection_reviewed_by::text, selection_reviewed_at,
    pricing_status, pricing_evidence, mapping_revision
  `
}

function productMutationParams(input: ProductMutationInput & { actorUserId: string }, status: ProductModerationStatus | null) {
  return [
    input.actorUserId,
    input.name.trim(),
    normalizeOptional(input.brand),
    normalizeOptional(input.platform),
    normalizeProductCategory(input.category, input.name, input.brand, input.platform, input.description, input.sku),
    input.sku.trim(),
    normalizeProductUnit(input.unit),
    Number(input.price ?? 0),
    Number(input.cost ?? 0),
    Number(input.stock ?? 0),
    normalizeOptional(input.image),
    normalizeOptional(input.description),
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.channels ?? []),
    status,
  ]
}

function validateProduct(input: ProductMutationInput) {
  const details: Record<string, string> = {}
  if (!input.name.trim()) details.name = "请填写产品名称"
  if (!input.sku.trim()) details.sku = "请填写 SKU"
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) details.price = "售价不能为负数"
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) details.cost = "成本不能为负数"
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) details.stock = "库存不能为负数"
  if (input.status && !["pending_review", "approved", "rejected", "inactive", "active"].includes(input.status)) {
    details.status = "产品状态无效"
  }
  if (Object.keys(details).length > 0) throw new ProductValidationError(details)
}

async function recordProductActivity(
  db: Queryable,
  input: {
    action: string
    actorUserId: string
    description: string
    entityId: string
    entityLabel: string
    title: string
  }
) {
  await db.query(
    `
    insert into activity_logs (
      actor_id, entity_type, entity_id, entity_label, action, title, description, metadata
    )
    values ($1::uuid, 'product', $2::uuid, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      input.actorUserId,
      input.entityId,
      input.entityLabel,
      input.action,
      input.title,
      input.description,
      JSON.stringify({ source: "product-admin" }),
    ]
  )
}

export function mapProduct(row: ProductRow): AdminProduct {
  return {
    ...productSelectionWithDefaults({
      catalogKind: row.catalog_kind, deviceTypeId: row.device_type_id, parentProductId: row.parent_product_id,
      manufacturerModel: row.manufacturer_model, specs: row.specs, protocols: row.protocols, capabilities: row.capabilities,
      selectionStatus: row.selection_status, selectionEvidence: row.selection_evidence,
      pricingStatus: row.pricing_status, pricingEvidence: row.pricing_evidence, mappingRevision: row.mapping_revision,
    }),
    selectionReviewedBy: row.selection_reviewed_by ?? null,
    selectionReviewedAt: row.selection_reviewed_at ? toIsoString(row.selection_reviewed_at) : null,
    brand: row.brand,
    category: normalizeProductCategory(row.category, row.name, row.brand, row.platform, row.description, row.sku),
    channels: normalizeStringArray(row.channels),
    cost: Number(row.cost ?? 0),
    createdAt: toIsoString(row.created_at),
    description: row.description,
    id: row.id,
    image: row.image,
    name: row.name,
    platform: row.platform,
    price: Number(row.price ?? 0),
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at ? toIsoString(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by,
    sku: row.sku,
    status: row.status,
    stock: Number(row.stock ?? 0),
    submittedBy: row.submitted_by,
    tags: normalizeStringArray(row.tags),
    unit: normalizeProductUnit(row.unit),
    updatedAt: toIsoString(row.updated_at),
  }
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeOptional(value?: string | null) {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

export function normalizeProductUnit(value?: string | null) {
  return String(value ?? "").trim() || DEFAULT_PRODUCT_UNIT
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}


const selectionFieldKeys = ["catalogKind", "deviceTypeId", "parentProductId", "manufacturerModel", "specs", "protocols", "capabilities", "selectionStatus", "selectionEvidence", "pricingStatus", "pricingEvidence", "mappingRevision"] as const

/** Pick submitted fields only: a normal catalog edit must not erase reviewed specs. */
export function productSelectionMutationFields(body: Record<string, unknown>): Partial<ProductSelectionFields> {
  return Object.fromEntries(selectionFieldKeys.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])) as Partial<ProductSelectionFields>
}

export function prepareProductSelection(input: ProductMutationInput, before?: AdminProduct): ProductSelectionFields {
  const fields = { ...(before ?? {}), ...productSelectionMutationFields(input as unknown as Record<string, unknown>) }
  let next: ProductSelectionFields
  try {
    next = productSelectionWithDefaults({ ...fields,
      selectionStatus: fields.selectionStatus === "verified" ? "pending" : fields.selectionStatus,
      pricingStatus: fields.pricingStatus === "verified" ? "pending" : fields.pricingStatus })
    next.selectionStatus = fields.selectionStatus ?? "pending"
    next.pricingStatus = fields.pricingStatus ?? "pending"
  }
  catch (error) { throw new ProductValidationError({ selection: error instanceof Error ? error.message : "选型参数无效" }) }
  if (before) {
    const identityKeys = ["catalogKind", "deviceTypeId", "parentProductId", "manufacturerModel", "specs", "protocols", "capabilities"] as const
    const identityChanged = identityKeys.some((key) => stableSelectionValue(next[key]) !== stableSelectionValue(before[key])) ||
      ["sku", "platform", "unit"].some((key) => input[key as "sku" | "platform" | "unit"] !== undefined && input[key as "sku" | "platform" | "unit"] !== before[key as "sku" | "platform" | "unit"])
    const priceChanged = (input.price !== undefined && input.price !== before.price) || (input.cost !== undefined && input.cost !== before.cost)
    if (identityChanged && before.selectionStatus === "verified") next.selectionStatus = "pending"
    if ((priceChanged || identityChanged) && before.pricingStatus === "verified") next.pricingStatus = "pending"
    const changed = identityChanged || priceChanged || next.selectionStatus !== before.selectionStatus || next.pricingStatus !== before.pricingStatus ||
      next.selectionEvidence !== before.selectionEvidence || next.pricingEvidence !== before.pricingEvidence ||
      (input.status !== undefined && input.status !== null && input.status !== before.status)
    next.mappingRevision = before.mappingRevision + Number(changed)
  } else next.mappingRevision = 1
  const validation = validateProductSelectionFields(next)
  if (validation.errors.length) throw new ProductValidationError({ selection: validation.errors.join("；") })
  return next
}

function selectionParams(fields: ProductSelectionFields) {
  return [fields.catalogKind, fields.deviceTypeId || null, fields.parentProductId || null, fields.manufacturerModel || null,
    JSON.stringify(fields.specs), JSON.stringify(fields.protocols), JSON.stringify(fields.capabilities),
    fields.selectionStatus, fields.selectionEvidence ?? "", fields.pricingStatus, fields.pricingEvidence ?? "", fields.mappingRevision]
}

async function inProductTransaction<T>(operation: (db: PoolClient) => Promise<T>) {
  const db = await getPool().connect()
  try { await db.query("begin"); const result = await operation(db); await db.query("commit"); return result }
  catch (error) { await db.query("rollback"); throw error }
  finally { db.release() }
}

async function lockProduct(db: Queryable, productId: string) {
  const result = await db.query<ProductRow>(`${productSelectSql()} where id=$1::uuid and deleted_at is null for update`, [productId])
  if (!result.rows[0]) throw new ProductValidationError({ productId: "产品不存在" })
  return mapProduct(result.rows[0])
}

async function validateParent(db: Queryable, fields: ProductSelectionFields, productId?: string) {
  if (!fields.parentProductId) return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.parentProductId)) throw new ProductValidationError({ parentProductId: "系列标识无效" })
  // Serialize with a concurrent edit of the parent before validating its role.
  await db.query("select id from products where id=$1::uuid and deleted_at is null for update", [fields.parentProductId])
  if (fields.parentProductId === productId) throw new ProductValidationError({ parentProductId: "产品不能引用自身" })
  if (fields.catalogKind !== "sku") throw new ProductValidationError({ parentProductId: "只有具体 SKU 可以关联系列" })
  const result = await db.query<{ id: string; catalog_kind: string; device_type_id: string | null; cycle: boolean }>(`
    with recursive ancestors as (
      select id,parent_product_id,catalog_kind,device_type_id,array[id] as path,false as cycle from products where id=$1::uuid and deleted_at is null
      union all select p.id,p.parent_product_id,p.catalog_kind,p.device_type_id,a.path || p.id,p.id=any(a.path)
      from products p join ancestors a on p.id=a.parent_product_id where not a.cycle
    ) select id::text,catalog_kind,device_type_id,cycle from ancestors`, [fields.parentProductId])
  const parent = result.rows[0]
  if (!parent || parent.catalog_kind !== "series") throw new ProductValidationError({ parentProductId: "父项必须是现有产品系列" })
  if (parent.device_type_id && fields.deviceTypeId && parent.device_type_id !== fields.deviceTypeId) throw new ProductValidationError({ parentProductId: "SKU 与父系列的设备类型不一致" })
  if (result.rows.some((row) => row.cycle || row.id === productId)) throw new ProductValidationError({ parentProductId: "产品系列不能循环引用" })
}

/** Must run in the same transaction before changing any product display data. */
export async function freezeProductQuoteSnapshots(db: Queryable, productId: string) {
  await db.query(`update quote_items qi set product_snapshot=jsonb_build_object(
    'version',1,'origin','legacy-migration','capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'name',coalesce(qi.name,p.name),'sku',p.sku,'spec',coalesce(qi.note,p.description,p.sku),
    'unit',coalesce(qi.unit,p.unit,'个'),'category',p.category,'image',p.image)
    from products p where qi.product_id=p.id and p.id=$1::uuid and qi.product_snapshot is null`, [productId])
}

function stableSelectionValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...value].sort())
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))))
  return JSON.stringify(value)
}
