import { createHash, randomUUID } from "node:crypto"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { Pool, PoolClient } from "pg"
import { quoteVerification } from "./quote-verification"

import type { AccountContext } from "./account-context"
import { normalizeDesignPlan } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"
import { assertPermission, assertWritableMembership, PointMapServiceError, requireContext, requireVisibleProject } from "./point-map-service"
import { usableProductImage } from "./product-image-source"
import type { ProductVisualAsset } from "./product-visual-assets"
import { loadProductVisualAssets } from "./product-visual-assets-service"
import { deliveryChanges, stableDeliveryJson, type ProjectDeliveryProduct, type ProjectDeliveryProject, type ProjectDeliveryQuote, type ProjectDeliveryQuoteItem, type ProjectDeliverySnapshot, type ProjectDeliverySummary } from "./project-delivery"
import { getPool } from "./server-db"

type Client = Pick<PoolClient, "query" | "release">
type Dependencies = {
  db?: Pick<Pool, "connect">
  now?: () => Date
  createId?: () => string
  freezeImage?: (source: string) => Promise<string>
  loadVisualAssets?: typeof loadProductVisualAssets
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_DELIVERY_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_DELIVERY_BYTES = 96 * 1024 * 1024

export class ProjectDeliveryError extends PointMapServiceError {
  constructor(code: string, status: number, message: string, public readonly issues: string[] = []) {
    super(code, status, message)
    this.name = "ProjectDeliveryError"
  }
}

/** Preview is read-only; it uses exactly the same capture/validation path as create. */
export async function previewProjectDelivery(context: AccountContext | null, projectId: string, dependencies: Dependencies = {}): Promise<ProjectDeliverySnapshot> {
  return deliveryTransaction(context, projectId, false, dependencies, async (client, account) => {
    assertPermission(account, "point_map.use")
    const previous = await latestSnapshot(client, projectId)
    return captureDelivery(client, projectId, previous, dependencies)
  })
}

export async function createProjectDelivery(context: AccountContext | null, projectId: string, dependencies: Dependencies = {}): Promise<ProjectDeliverySnapshot> {
  // Concurrent repeatable-read transactions may acquire their snapshot before
  // the other editor commits. Retry that transaction, rather than mixing reads.
  for (let attempt = 0; ; attempt++) {
    try { return await createDeliveryOnce(context, projectId, dependencies) }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
      if (attempt >= 2 || !["40001", "40P01", "23505"].includes(code)) throw error
    }
  }
}

async function createDeliveryOnce(context: AccountContext | null, projectId: string, dependencies: Dependencies): Promise<ProjectDeliverySnapshot> {
  return deliveryTransaction(context, projectId, true, dependencies, async (client, account) => {
    const previous = await latestSnapshot(client, projectId)
    const snapshot = await captureDelivery(client, projectId, previous, dependencies)
    const existing = await client.query<{ snapshot: ProjectDeliverySnapshot }>(
      `select snapshot from project_deliveries where project_id = $1::uuid and fingerprint = $2`, [projectId, snapshot.fingerprint],
    )
    if (existing.rows[0]) return { ...existing.rows[0].snapshot, reused: true }
    const version = (previous?.version ?? 0) + 1
    const id = dependencies.createId?.() ?? randomUUID()
    const stored: ProjectDeliverySnapshot = { ...snapshot, id, version }
    await client.query(
      `insert into project_deliveries (id, project_id, version, fingerprint, snapshot, created_by, created_at)
       values ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::uuid, $7::timestamptz)`,
      [id, projectId, version, stored.fingerprint, JSON.stringify(stored), account.user.userId, stored.createdAt],
    )
    return stored
  })
}

export async function listProjectDeliveries(context: AccountContext | null, projectId: string, dependencies: Dependencies = {}): Promise<ProjectDeliverySummary[]> {
  return deliveryTransaction(context, projectId, false, dependencies, async (client) => {
    // Select the summary only; list requests never transfer floor/product image bytes.
    const result = await client.query<{ summary: ProjectDeliverySummary }>(
      `select jsonb_build_object('id', id::text, 'version', version, 'createdAt', snapshot->'createdAt',
         'pointMapRevision', snapshot->'pointMapRevision', 'fingerprint', fingerprint, 'changes', snapshot->'changes',
         'quoteNo', snapshot->'quote'->'quoteNo', 'total', snapshot->'quote'->'total') as summary
       from project_deliveries where project_id = $1::uuid order by version desc limit 100`, [projectId],
    )
    return result.rows.map((row) => row.summary)
  })
}

export async function getProjectDelivery(context: AccountContext | null, projectId: string, deliveryId: string, dependencies: Dependencies = {}): Promise<ProjectDeliverySnapshot> {
  const account = requireContext(context, projectId)
  if (!UUID.test(deliveryId)) throw new ProjectDeliveryError("DELIVERY_NOT_FOUND", 404, "DELIVERY_NOT_FOUND")
  return deliveryTransaction(account, projectId, false, dependencies, async (client) => {
    const result = await client.query<{ snapshot: ProjectDeliverySnapshot }>(
      `select snapshot from project_deliveries where project_id = $1::uuid and id = $2::uuid`, [projectId, deliveryId],
    )
    if (!result.rows[0]) throw new ProjectDeliveryError("DELIVERY_NOT_FOUND", 404, "DELIVERY_NOT_FOUND")
    // Historical reads intentionally do not load today's catalogue or files.
    return result.rows[0].snapshot
  })
}

async function deliveryTransaction<T>(context: AccountContext | null, projectId: string, writable: boolean, dependencies: Dependencies, action: (client: Client, account: AccountContext) => Promise<T>): Promise<T> {
  const account = requireContext(context, projectId)
  const client = await (dependencies.db ?? getPool()).connect()
  try {
    await client.query(writable ? "begin isolation level repeatable read" : "begin isolation level repeatable read read only")
    const project = await requireVisibleProject(client, account, projectId, writable)
    if (writable) {
      // A pure quote has no point-map data to read or write. Expose this narrow
      // distinction only after project visibility, so its existing PDF exporter
      // can continue without treating a paid-feature denial as an empty plan.
      const savedPlan = await client.query<{ exists: boolean }>(
        `select exists(select 1 from project_point_map_designs where project_id = $1::uuid) as exists`, [projectId],
      )
      if (!savedPlan.rows[0]?.exists) throw new ProjectDeliveryError("DELIVERY_PLAN_REQUIRED", 409, "请先保存项目点位方案，再生成交付版本。")
      assertPermission(account, "point_map.use")
      assertPermission(account, "project.edit")
      assertWritableMembership(account, project)
    }
    const result = await action(client, account)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally { client.release() }
}

async function latestSnapshot(client: Client, projectId: string): Promise<ProjectDeliverySnapshot | null> {
  const result = await client.query<{ snapshot: ProjectDeliverySnapshot }>(
    `select snapshot from project_deliveries where project_id = $1::uuid order by version desc limit 1`, [projectId],
  )
  return result.rows[0]?.snapshot ?? null
}

async function captureDelivery(client: Client, projectId: string, previous: ProjectDeliverySnapshot | null, dependencies: Dependencies): Promise<ProjectDeliverySnapshot> {
  const projectResult = await client.query<ProjectDeliveryProject>(
    `select id::text, name, coalesce(code, '') as code, coalesce(customer_name, client_name, '') as customer,
       trim(concat_ws(' ', community, building, room_no)) as address
     from projects where id = $1::uuid and deleted_at is null`, [projectId],
  )
  const planResult = await client.query<{ plan: PointMapPlan; revision: number }>(
    `select plan, revision from project_point_map_designs where project_id = $1::uuid`, [projectId],
  )
  const storedPlan = planResult.rows[0]
  if (!storedPlan) throw new ProjectDeliveryError("DELIVERY_PLAN_REQUIRED", 409, "请先保存项目点位方案，再生成交付版本。")
  const plan = normalizeDesignPlan(storedPlan.plan)
  const quote = await readQuote(client, projectId)
  const overrides = assertDeliverySources(plan, quote)
  const pointById = new Map(plan.points.map((point) => [point.id, point]))
  const quoteMapped = new Set((quote?.items ?? []).flatMap((item) => (item.pointIds ?? []).filter((id) => !pointById.get(id)?.materials?.some((material) => material.productId === item.id))))
  const usedIds = [...new Set([
    ...(quote?.items ?? []).map((item) => item.id),
    ...plan.points.filter((point) => point.placed && !quoteMapped.has(point.id)).map((point) => point.productId).filter(Boolean),
  ])].sort()
  if (usedIds.some((id) => !UUID.test(id))) throw new ProjectDeliveryError("DELIVERY_PRODUCT_INVALID", 409, "方案含无效商品引用，请重新选择对应商品。")
  const catalog = usedIds.length ? (await client.query<{ id: string; name: string; image: string | null }>(
    `select id::text, name, image from products where id = any($1::uuid[])`, [usedIds],
  )).rows : []
  const byId = new Map(catalog.map((product) => [product.id, product]))
  const visuals = await (dependencies.loadVisualAssets ?? loadProductVisualAssets)(client, usedIds)
  const frozen = new Map<string, Promise<string>>()
  const freeze = (source: string) => {
    let pending = frozen.get(source)
    if (!pending) { pending = (dependencies.freezeImage ?? freezeDeliveryImage)(source); frozen.set(source, pending) }
    return pending
  }
  const products: ProjectDeliveryProduct[] = []
  let estimatedBytes = Buffer.byteLength(JSON.stringify({ plan, quote }), "utf8")
  for (const id of usedIds) {
    const product = byId.get(id)
    const historical = quote?.items.find((item) => item.id === id)
    const asset = visuals.get(id) ?? null
    const visualSource = usableProductImage(asset?.image)
    const source = visualSource ?? usableProductImage(product?.image) ?? usableProductImage(historical?.image) ?? null
    const mappedToPoint = plan.points.some((point) => point.placed && (quoteMapped.has(point.id)
      ? quote?.items.some((item) => item.id === id && item.pointIds?.includes(point.id) && !point.materials?.some((material) => material.productId === id))
      : point.productId === id))
    if (!source && mappedToPoint) throw new ProjectDeliveryError("DELIVERY_PRODUCT_IMAGE_REQUIRED", 409, `${product?.name ?? historical?.name ?? id}：已关联点位但缺少商品图片，请先补图。`)
    let image: string | null = null
    let visualAsset: ProductVisualAsset | null = null
    try {
      if (source) image = await freeze(source)
      // sourceImage is provenance only. It can be an official remote URL and is
      // never fetched or rendered; the actual image above is frozen in full.
      if (asset && visualSource && image) visualAsset = { ...asset, image }
    } catch (error) {
      if (error instanceof ProjectDeliveryError) throw new ProjectDeliveryError(error.code, error.status, `${product?.name ?? historical?.name ?? id}：${error.message}`, error.issues)
      throw error
    }
    if (image) {
      // Estimate duplication in the serialized snapshot before JSON.stringify
      // allocates it: each quote row also preserves its product snapshot.
      const references = (quote?.items.filter((item) => item.id === id).length ?? 0)
      estimatedBytes += Buffer.byteLength(image, "utf8") * (visualAsset ? 4 + references * 3 : 2 + references * 2)
      if (estimatedBytes > MAX_DELIVERY_BYTES) throw new ProjectDeliveryError("DELIVERY_TOO_LARGE", 413, "方案图片总量过大，请先压缩底图和商品图片。")
    }
    products.push({ id, name: historical?.name ?? product?.name ?? id, image, imageSource: source, visualAsset })
  }
  const productMap = new Map(products.map((product) => [product.id, product]))
  // Only the snapshot copy receives current display assets. Quote identity, prices,
  // names and the mutable quote table remain untouched.
  if (quote) for (const item of quote.items) {
    const product = productMap.get(item.id)
    item.imageSource = product?.imageSource ?? null
    item.image = product?.image ?? "/placeholder.svg"
    item.productSnapshot = { ...(item.productSnapshot ?? {}), image: item.image, ...(product?.visualAsset ? { visualAsset: product.visualAsset } : {}) }
    if (!product?.visualAsset) delete item.productSnapshot.visualAsset
  }
  const blankChanges = { comparedToVersion: null, floorIds: [], pointsAdded: 0, pointsRemoved: 0, pointsChanged: 0, productsChanged: [], photosChanged: [], scenesChanged: false, quoteChanged: false, productOverrides: overrides, messages: [] }
  const snapshot: ProjectDeliverySnapshot = {
    id: null, version: 0, createdAt: (dependencies.now?.() ?? new Date()).toISOString(), project: projectResult.rows[0],
    plan, pointMapRevision: storedPlan.revision, quote, products, changes: blankChanges, fingerprint: "",
  }
  snapshot.fingerprint = deliveryFingerprint(snapshot)
  snapshot.changes = deliveryChanges(snapshot, previous, overrides)
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_DELIVERY_BYTES) throw new ProjectDeliveryError("DELIVERY_TOO_LARGE", 413, "方案图片总量过大，请先压缩底图和商品图片。")
  return snapshot
}

type QuoteRow = Omit<ProjectDeliveryQuote, "items" | "installationFee" | "rooms"> & { note: string | null }
async function readQuote(client: Client, projectId: string): Promise<ProjectDeliveryQuote | null> {
  const result = await client.query<QuoteRow>(
    `select id::text, quote_no as "quoteNo", title, status::text,
       subtotal_amount::float8 as subtotal, discount_amount::float8 as discount, total_amount::float8 as total, note
     from quotes where project_id = $1::uuid and status = 'draft' and deleted_at is null order by updated_at desc, id desc limit 1`, [projectId],
  )
  const row = result.rows[0]
  if (!row) return null
  let note: { installationFee?: unknown; rooms?: unknown } = {}
  try { if (row.note?.trim().startsWith("{")) note = JSON.parse(row.note) } catch { /* Old plain notes have no installation metadata. */ }
  const items = await client.query<ProjectDeliveryQuoteItem>(
    `select qi.id::text as "lineId", qi.product_id::text as id,
       qi.point_map_project_id::text as "pointMapProjectId", qi.point_ids as "pointIds", qi.point_map_revision as "pointMapRevision",
       qi.product_snapshot as "productSnapshot", coalesce(qi.product_snapshot->>'name', qi.name, p.name) as name,
       coalesce(qi.product_snapshot->>'sku', p.sku, '') as sku,
       coalesce(qi.product_snapshot->>'spec', qi.note, p.description, p.sku, '') as spec,
       case when qi.product_snapshot is not null then coalesce(qi.product_snapshot->>'category','') else coalesce(p.category,'') end as category,
       coalesce(qi.product_snapshot->>'unit', qi.unit, p.unit, '个') as unit,
       coalesce(qi.unit_price,0)::float8 as price, coalesce(qi.cost_price,0)::float8 as cost,
       coalesce(qi.room,'全屋') as room, coalesce(qi.quantity,1)::float8 as quantity,
       case when coalesce(qi.unit_price,0)=0 then 100 else (coalesce(qi.final_unit_price,qi.unit_price)/qi.unit_price*100)::float8 end as discount,
       coalesce(qi.final_unit_price,qi.unit_price,0)::float8 as "finalUnitPrice",
       coalesce(qi.subtotal_amount,qi.unit_price*qi.quantity,0)::float8 as "subtotalAmount",
       coalesce(qi.final_amount,coalesce(qi.final_unit_price,qi.unit_price)*qi.quantity,0)::float8 as "finalAmount",
       case when qi.product_snapshot is not null then qi.product_snapshot->>'image' else p.image end as image
     from quote_items qi left join products p on p.id=qi.product_id
     where qi.quote_id=$1::uuid and qi.deleted_at is null order by qi.sort_order asc, qi.created_at asc, qi.id asc`, [row.id],
  )
  if (![row.subtotal, row.discount, row.total].every(Number.isFinite) || items.rows.some((item) => ![item.price, item.quantity, item.discount, item.finalUnitPrice, item.finalAmount].every(Number.isFinite))) {
    throw new ProjectDeliveryError("DELIVERY_QUOTE_INVALID", 409, "已保存报价含无效金额，请先核对报价。")
  }
  return {
    id: row.id, quoteNo: row.quoteNo, title: row.title, status: row.status,
    subtotal: row.subtotal, discount: row.discount, total: row.total,
    installationFee: typeof note.installationFee === "number" && Number.isFinite(note.installationFee) ? note.installationFee : 0,
    rooms: Array.isArray(note.rooms) ? note.rooms.filter((room): room is string => typeof room === "string") : [], items: items.rows,
  }
}

/** Semantic source checks deliberately ignore point-map revisions and layout. */
export function assertDeliverySources(plan: PointMapPlan, quote: ProjectDeliveryQuote | null): number {
  if (!quote) return 0
  const issues: string[] = []
  const pointById = new Map(plan.points.map((point) => [point.id, point]))
  const floorById = new Map((plan.floors ?? []).map((floor) => [floor.id, floor.name]))
  const mainByPoint = new Map<string, string>()
  let overrides = 0
  for (const item of quote.items) {
    const ids = item.pointIds ?? []
    if (item.pointMapProjectId && item.pointMapProjectId !== plan.projectId) { issues.push(`${item.name}：报价点位来源属于其他项目。`); continue }
    if (!ids.length) {
      if (item.pointMapProjectId) issues.push(`${item.name}：点位来源为空，请重新同步这条报价。`)
      continue
    }
    if (new Set(ids).size !== ids.length) issues.push(`${item.name}：关联点位重复。`)
    let expected = 0
    const physicalIds = new Set<string>()
    for (const id of new Set(ids)) {
      const point = pointById.get(id)
      if (!point) { issues.push(`${item.name}：关联点位 ${id} 已不存在。`); continue }
      const expectedRoom = point.floorId && floorById.has(point.floorId) ? `${floorById.get(point.floorId)} / ${point.room}` : point.room
      if (item.room !== expectedRoom) issues.push(`${point.code || id}：房间已变为“${expectedRoom}”，报价仍为“${item.room}”。`)
      const material = point.materials?.filter((entry) => entry.productId === item.id)
      if (material?.length) {
        for (const entry of material) {
          if (entry.included) continue
          if (entry.quantity == null || entry.unit !== item.unit) { issues.push(`${point.code || id}：配套材料数量或单位需要核对。`); continue }
          if (entry.physicalDeviceId) {
            if (physicalIds.has(entry.physicalDeviceId)) continue
            physicalIds.add(entry.physicalDeviceId)
            if (pointById.get(entry.physicalDeviceId)?.productId === item.id) continue
          }
          expected += entry.quantity
        }
        continue
      }
      const verification = quoteVerification(item)
      if (!point.placed && !(verification.status === "unverified" && verification.source === "default")) issues.push(`${point.code || id}：点位尚未定位，无法与报价一起交付。`)
      if (point.usage === "reserve") issues.push(`${point.code || id}：点位已改为预留，报价仍包含主设备。`)
      const previous = mainByPoint.get(id)
      if (previous && previous !== item.id) issues.push(`${point.code || id}：同时关联多个主商品，请先整理报价对应关系。`)
      else if (previous) issues.push(`${point.code || id}：主设备在报价中重复计数。`)
      mainByPoint.set(id, item.id)
      if (point.productId && point.productId !== item.id) overrides++
      expected++
    }
    if (Math.abs(expected - item.quantity) > 0.000001) issues.push(`${item.name}：报价数量 ${item.quantity} 与关联点位/材料数量 ${expected} 不一致。`)
  }
  if (quote.items.some((item) => item.pointMapProjectId)) for (const point of plan.points) {
    if (point.usage === "selected" && point.placed && point.productId && !mainByPoint.has(point.id)) issues.push(`${point.code || point.id}：已选用的主设备尚未加入当前报价。`)
  }
  if (issues.length) throw new ProjectDeliveryError("DELIVERY_SOURCE_CONFLICT", 409, "点位与已保存报价需要核对，未生成混合版本。", [...new Set(issues)])
  return overrides
}

export function deliveryFingerprint(snapshot: ProjectDeliverySnapshot): string {
  const plan: Partial<PointMapPlan> = { ...snapshot.plan }
  delete plan.updatedAt
  delete plan.activeFloorId
  delete plan.floorplanName
  delete plan.floorplanDataUrl
  const selectionContent = (selection: Record<string, unknown>) => {
    const content = { ...selection }
    delete content.verifiedAt
    return content
  }
  plan.points = plan.points?.map((point) => ({
    ...point,
    ...(point.selection ? { selection: selectionContent(point.selection) } : {}),
    ...(point.materials ? { materials: point.materials.map((material) => ({ ...material, ...(material.selection ? { selection: selectionContent(material.selection) } : {}) })) } : {}),
  })) as PointMapPlan["points"]
  const quote = snapshot.quote && { ...snapshot.quote, items: snapshot.quote.items.map((original) => {
    const item: Partial<ProjectDeliveryQuoteItem> = { ...original }
    delete item.lineId
    delete item.pointMapRevision
    const productSnapshot = item.productSnapshot ? { ...item.productSnapshot } : undefined
    if (productSnapshot) {
      delete productSnapshot.pointMapRevision
      delete productSnapshot.capturedAt
    }
    return { ...item, productSnapshot }
  }) }
  return createHash("sha256").update(stableDeliveryJson({ project: snapshot.project, plan, quote, products: snapshot.products })).digest("hex")
}

/** Archive only controlled local raster files or existing raster data URLs. */
export async function freezeDeliveryImage(source: string, options: { publicDirectory?: string; maxBytes?: number } = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_DELIVERY_IMAGE_BYTES
  if (/^data:/i.test(source)) {
    const match = /^data:image\/(png|jpe?g|webp|gif|avif);base64,([a-z0-9+/]+={0,2})$/i.exec(source)
    if (!match || Buffer.byteLength(match[2], "base64") > maxBytes) throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图格式无效或超过大小限制，请使用 PNG/JPEG/WebP 图片。")
    if (!rasterMime(Buffer.from(match[2], "base64"))) throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图数据不是可归档的标准图片。")
    return source
  }
  if (!source.startsWith("/assets/") || source.startsWith("//")) throw new ProjectDeliveryError("DELIVERY_IMAGE_ARCHIVE_REQUIRED", 409, "商品图尚未归档；请先把远程图片保存到产品图库，再生成固定版本。")
  let pathname: string
  try { pathname = decodeURIComponent(source.split(/[?#]/, 1)[0]) }
  catch { throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图路径无效。") }
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((part) => part === "." || part === "..")) throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图路径无效。")
  try {
    const root = await realpath(path.join(options.publicDirectory ?? path.join(process.cwd(), "public"), "assets"))
    const target = await realpath(path.join(options.publicDirectory ?? path.join(process.cwd(), "public"), pathname))
    if (!target.startsWith(root + path.sep)) throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图路径无效。")
    const metadata = await stat(target)
    if (!metadata.isFile() || metadata.size > maxBytes) throw new ProjectDeliveryError("DELIVERY_IMAGE_TOO_LARGE", 413, "商品图超过大小限制，请先压缩。")
    const bytes = await readFile(target)
    if (bytes.length > maxBytes) throw new ProjectDeliveryError("DELIVERY_IMAGE_TOO_LARGE", 413, "商品图超过大小限制，请先压缩。")
    const mime = rasterMime(bytes)
    if (!mime) throw new ProjectDeliveryError("DELIVERY_IMAGE_INVALID", 409, "商品图需要使用 PNG/JPEG/WebP 等标准图片。")
    return `data:${mime};base64,${bytes.toString("base64")}`
  } catch (error) {
    if (error instanceof ProjectDeliveryError) throw error
    throw new ProjectDeliveryError("DELIVERY_IMAGE_UNAVAILABLE", 409, "商品图文件无法读取，请重新上传。")
  }
}

function rasterMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif"
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "image/avif"
  return null
}
