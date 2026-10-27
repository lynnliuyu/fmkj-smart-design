import type { Pool, PoolClient } from "pg"

import { secondsBetween, tryRecordActivity } from "./server-activity-log"
import { canViewProductCost } from "./product-cost"
import { lineAmount, roundMoney, sumMoney } from "./money"
import { getPool } from "./server-db"
import { buildStoredProcurementPreview } from "./point-map-procurement-service"
import { loadSelectionProducts } from "./point-map-selection-service"
import type { AccountContext } from "./account-context"
import { requireContext, requireVisibleProject, assertPermission, assertWritableMembership } from "./point-map-service"
import { removePointsFromPlan } from "./point-map-quote-removal"
import { POINT_ROOM_MAX_LENGTH } from "./point-map-rooms"
import type { PointMapPlan } from "./point-map-plan"
import { usableProductImage } from "./product-image-source"
import { catalogQuotationVerification, quoteVerification, type QuotationVerification } from "./quote-verification"

export type QuoteItemPayload = {
  productId: string
  name: string
  spec: string
  room: string
  unit: string
  quantity: number
  price: number
  /** An omitted cost means the caller did not receive internal cost data; explicit 0 is a real value. */
  cost?: number | null
  discount: number
  pointMapProjectId?: string
  pointIds?: string[]
  pointMapRevision?: number
  productSnapshot?: Record<string, unknown>
}

export type SaveQuoteDraftInput = {
  /** Explicitly refresh photos in this editable draft; retain its identity and money snapshots. */
  refreshProductImages?: boolean
  discount?: number
  installationFee?: number
  items?: QuoteItemPayload[]
  projectId?: string
  projectName?: string
  pointMapRevision?: number
  /** 报价页中被移除的点位（删除报价行或区域时由客户端列出），保存时同步删除点位设计中的对应点位。 */
  removedPointIds?: string[]
  /** 报价页修改了点位来源行的房间：把这些点位移到新房间。 */
  pointRoomMoves?: Array<{ pointIds: string[]; room: string }>
  rooms?: unknown[]
  subtotal?: number
  total?: number
}

export type SaveQuoteDraftResult = {
  id: string
  updatedAt?: string
  quoteNo: string
  savedItems: number
  skippedItems: number
  pointMapRevision?: number
}

type QuoteSaveDependencies = {
  context?: AccountContext
  actorName?: string
  actorUserId?: string
  createQuoteNo?: () => string
  db?: Pool
  now?: () => Date
}

type QuoteSaveClient = Pick<PoolClient, "query" | "release">

const SYSTEM_USER_ID = "10000000-0000-0000-0000-000000000002"
const SYSTEM_ACTOR_NAME = "\u7cfb\u7edf"

export class QuoteSaveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = "QuoteSaveError"
  }
}

export async function saveQuoteDraft(
  input: SaveQuoteDraftInput,
  dependencies: QuoteSaveDependencies = {},
): Promise<SaveQuoteDraftResult> {
  const db = dependencies.db ?? getPool()
  const client = await db.connect()

  try {
    await client.query("begin")
    const result = await saveQuoteDraftInTransaction(client, input, dependencies)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function saveQuoteDraftInTransaction(
  client: QuoteSaveClient,
  input: SaveQuoteDraftInput,
  dependencies: QuoteSaveDependencies,
): Promise<SaveQuoteDraftResult> {
  const projectId = String(input.projectId || "")
  const projectName = String(input.projectName || "")
  let items = Array.isArray(input.items) ? input.items : []
  let validItems = items.filter((item) => isUuid(item.productId))
  const removedPointIds = Array.isArray(input.removedPointIds) ? input.removedPointIds.map(String).filter(Boolean) : []
  const installationFee = Number(input.installationFee ?? 0)
  const invalidCost = (item: QuoteItemPayload) => item.cost !== undefined && item.cost !== null && (!Number.isFinite(item.cost) || item.cost < 0)
  if (!Number.isFinite(installationFee) || installationFee < 0 || validItems.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0 || invalidCost(item) || !Number.isFinite(item.discount) || item.discount < 0 || item.discount > 100)) throw new QuoteSaveError("报价数量或金额无效", 400)
  // 金额一律按“分”的整数计算，避免 99.99999999999999 这类浮点尾巴进库或进报价单。
  const subtotal = sumMoney(validItems.map((item) => lineAmount(item.price, item.quantity)))
  const payable = sumMoney(validItems.map((item) => lineAmount(item.price, item.quantity, item.discount)))
  const discount = roundMoney(subtotal - payable)
  const total = roundMoney(payable + installationFee)
  const rooms = Array.isArray(input.rooms)
    ? input.rooms.map((room) => String(room).trim()).filter(Boolean)
    : []
  const note = JSON.stringify({ installationFee, rooms })
  const actorUserId = dependencies.actorUserId ?? SYSTEM_USER_ID
  const actorName = dependencies.actorName ?? SYSTEM_ACTOR_NAME
  const project = await client.query<{
    createdAt: Date
    id: string
    name: string
  }>(
    `
    select id::text, name, created_at as "createdAt"
    from projects
    where deleted_at is null
      and (($1::uuid is not null and id = $1::uuid) or ($1::uuid is null and $2 <> '' and name = $2))
    order by updated_at desc
    limit 1
    `,
    [isUuid(projectId) ? projectId : null, projectName],
  )

  if (!project.rows[0]) {
    throw new QuoteSaveError("PROJECT_NOT_FOUND", 404)
  }

  const resolvedProject = project.rows[0]
  if (dependencies.context) {
    const context = requireContext(dependencies.context, resolvedProject.id)
    const visible = await requireVisibleProject(client, context, resolvedProject.id, true)
    assertPermission(context, "project.edit")
    assertWritableMembership(context, visible)
    if (items.some((item) => item.pointMapProjectId) || input.pointMapRevision !== undefined || removedPointIds.length || input.pointRoomMoves?.length) assertPermission(context, "point_map.use")
  }
  const existingQuote = await client.query<{ id: string; quote_no: string }>(
    `
    select id::text, quote_no
    from quotes
    where deleted_at is null
      and project_id = $1::uuid
      and status = 'draft'
    order by updated_at desc
    limit 1
    `,
    [resolvedProject.id],
  )
  // 点位来源的报价行与点位设计在同一事务中同步：删除行/区域删除点位，改房间移动点位。
  // 客户端携带的点位版本必须与数据库一致，过期时拒绝保存（需先在点位设计保存以同步报价）。
  const roomMoves = Array.isArray(input.pointRoomMoves) ? input.pointRoomMoves.filter((move) => move && Array.isArray(move.pointIds) && typeof move.room === "string") : []
  let pointMapRevision = input.pointMapRevision
  if (removedPointIds.length || roomMoves.length) {
    const stored = await client.query<{ revision: number; plan: PointMapPlan }>(
      `select revision, plan from project_point_map_designs where project_id = $1::uuid for update`,
      [resolvedProject.id],
    )
    const row = stored.rows[0]
    if (!row) throw new QuoteSaveError("点位设计不存在，无法同步点位", 409)
    if (pointMapRevision !== row.revision) throw new QuoteSaveError("点位设计已变化或缺少来源版本，请刷新报价后重试", 409)
    let nextPlan = removePointsFromPlan(row.plan, removedPointIds)
    for (const move of roomMoves) {
      const ids = new Set(move.pointIds)
      const room = move.room.includes(" / ") ? move.room.slice(move.room.indexOf(" / ") + 3) : move.room
      if (!room.trim() || room.length > POINT_ROOM_MAX_LENGTH) throw new QuoteSaveError("房间名称无效", 400)
      const moved = nextPlan.points.filter((point) => ids.has(point.id))
      if (moved.some((point) => {
        const floor = nextPlan.floors?.find((floor) => floor.id === point.floorId)
        return floor && move.room !== `${floor.name} / ${room}`
      })) throw new QuoteSaveError("跨楼层移动需要在点位设计中重新定位，请先保存点位后再同步报价", 409)
      nextPlan = { ...nextPlan, points: nextPlan.points.map((point) => (ids.has(point.id) ? { ...point, room } : point)) }
    }
    const nextRevision = row.revision + 1
    await client.query(
      `update project_point_map_designs set plan = $2::jsonb, revision = $3, updated_at = now() where project_id = $1::uuid`,
      [resolvedProject.id, JSON.stringify(nextPlan), nextRevision],
    )
    pointMapRevision = nextRevision
    // 同步后仍保留的来源行对齐到新版本，再与新版本的预览比对。
    items = items.map((item) => (item.pointMapProjectId ? { ...item, pointMapRevision: nextRevision } : item))
    validItems = items.filter((item) => isUuid(item.productId))
  }
  const sourced = items.filter((item) => item.pointMapProjectId)
  const sourceVerifications = new Map<string, QuotationVerification>()
  if (sourced.length || pointMapRevision !== undefined) {
    if (sourced.some((item) => item.pointMapProjectId !== resolvedProject.id)) throw new QuoteSaveError("点位报价来源不属于当前项目", 400)
    const revision = pointMapRevision ?? sourced[0]?.pointMapRevision
    if (!Number.isSafeInteger(revision) || !revision || sourced.some((item) => item.pointMapRevision !== revision)) throw new QuoteSaveError("点位报价需要从已保存方案重新预览同步", 409)
    pointMapRevision = revision
    const preview = await buildStoredProcurementPreview(client, resolvedProject.id, revision)
    if (preview.blocked) throw new QuoteSaveError("点位选型尚未完成，请先处理选型问题并重新同步", 409)
    const expected = new Map(preview.data.items.map((item) => [JSON.stringify([item.id, item.room]), item]))
    if (expected.size !== sourced.length) throw new QuoteSaveError("点位数量已变化，请重新预览同步", 409)
    for (const item of sourced) {
      const key = JSON.stringify([item.productId, item.room])
      const match = expected.get(key)
      const ids = [...(item.pointIds ?? [])].sort()
      if (!match || match.quantity !== item.quantity || match.unit !== item.unit || JSON.stringify([...(match.pointIds ?? [])].sort()) !== JSON.stringify(ids)) throw new QuoteSaveError("点位产品、数量或来源不匹配，请重新同步", 409)
      sourceVerifications.set(key, quoteVerification(match))
      expected.delete(key)
    }
  }
  const existingSnapshots = existingQuote.rows[0] ? await client.query<{ product_id: string; room: string; cost_price: number | null; product_snapshot: Record<string, unknown> | null }>(
    `select product_id::text, room, cost_price::float8, product_snapshot from quote_items where quote_id=$1::uuid and deleted_at is null`, [existingQuote.rows[0].id],
  ) : { rows: [] }
  const previousSnapshotFor = (item: QuoteItemPayload) => {
    const matches = existingSnapshots.rows.filter((row) => row.product_id === item.productId && row.product_snapshot)
    const supplied = item.productSnapshot && matches.find((row) => JSON.stringify(row.product_snapshot) === JSON.stringify(item.productSnapshot))
    if (supplied) return supplied.product_snapshot
    const sameRoom = matches.filter((row) => row.room === item.room)
    if (sameRoom.length === 1) return sameRoom[0].product_snapshot
    if (!sameRoom.length && matches.length === 1) return matches[0].product_snapshot
    return undefined
  }
  const catalog = new Map((await loadSelectionProducts(client, items.map((item) => item.productId))).map((product) => [product.id, product]))
  // 客户端可能看不到进货成本（企业里的编辑/查看者），保存时用目录里的成本兜底：
  // 否则普通销售保存的报价成本记成 0，管理者看到的毛利就全错了。
  const catalogCost = new Map<string, number>(
    (await client.query<{ cost: number; id: string }>(
      `select id::text as id, coalesce(cost, 0)::float8 as cost from products where id = any($1::uuid[])`,
      [(items ?? []).map((item) => item.productId).filter((id) => isUuid(id))],
    )).rows.map((row) => [row.id, Number(row.cost)]),
  )
  // 成本字段可能因为权限而被调用方省略；无权查看成本的账号提交的占位值也必须回退到目录成本。
  // 有财务权限时，显式 0 代表该项目确认的零成本，不能再被真值判断改写成目录成本。
  const trustSubmittedCost = !dependencies.context || canViewProductCost(dependencies.context)
  const projectCosts = new Map((await client.query<{ product_id: string; cost_price: number | null }>(
    `select product_id::text, cost_price::float8 from project_product_prices where project_id=$1::uuid and product_id=any($2::uuid[])`,
    [resolvedProject.id, validItems.map((item) => item.productId)],
  )).rows.filter((row) => row.cost_price !== null).map((row) => [row.product_id, Number(row.cost_price)]))
  const storedCost = (item: QuoteItemPayload) => {
    const previous = existingSnapshots.rows.filter((row) => row.product_id === item.productId)
    const sameRoom = previous.filter((row) => row.room === item.room)
    const saved = sameRoom.length === 1 ? sameRoom[0] : previous.length === 1 ? previous[0] : undefined
    return saved?.cost_price ?? projectCosts.get(item.productId) ?? catalogCost.get(item.productId) ?? 0
  }
  const itemCost = (item: QuoteItemPayload) => roundMoney(trustSubmittedCost && item.cost !== undefined && item.cost !== null
    ? Number(item.cost)
    : Number(storedCost(item)))
  const cost = sumMoney(validItems.map((item) => lineAmount(itemCost(item), item.quantity)))
  const isExistingQuote = Boolean(existingQuote.rows[0])
  const quoteNo = existingQuote.rows[0]?.quote_no ?? (dependencies.createQuoteNo ?? makeQuoteNo)()
  const quoteTitle = `${resolvedProject.name} \u62a5\u4ef7\u8349\u7a3f`

  const savedQuote = existingQuote.rows[0]
    ? await client.query<{ id: string; quote_no: string; updatedAt?: Date }>(
        `
        update quotes
        set quote_no = $2,
            title = $3,
            subtotal_amount = $4,
            discount_amount = $5,
            total_amount = $6,
            cost_amount = $7,
            gross_margin_amount = $6::numeric - $7::numeric,
            gross_margin_rate = case when $6::numeric = 0 then 0 else ($6::numeric - $7::numeric) / $6::numeric end,
            note = $8,
            updated_by = $9,
            updated_at = now()
        where id = $1::uuid
        returning id::text, quote_no, updated_at as "updatedAt"
        `,
        [
          existingQuote.rows[0].id,
          quoteNo,
          quoteTitle,
          subtotal,
          discount,
          total,
          cost,
          note,
          actorUserId,
        ],
      )
    : await client.query<{ id: string; quote_no: string; updatedAt?: Date }>(
        `
        insert into quotes (
          created_by, updated_by, status, project_id, quote_no, title, version,
          subtotal_amount, discount_amount, total_amount, cost_amount,
          gross_margin_amount, gross_margin_rate, note
        )
        values ($1, $1, 'draft', $2::uuid, $3, $4, 1, $5, $6, $7, $8, $7::numeric - $8::numeric,
          case when $7::numeric = 0 then 0 else ($7::numeric - $8::numeric) / $7::numeric end,
          $9)
        returning id::text, quote_no, updated_at as "updatedAt"
        `,
        [
          actorUserId,
          resolvedProject.id,
          quoteNo,
          quoteTitle,
          subtotal,
          discount,
          total,
          cost,
          note,
        ],
      )

  const quoteId = savedQuote.rows[0].id
  await client.query(`delete from quote_items where quote_id = $1::uuid`, [quoteId])

  for (const [index, item] of validItems.entries()) {
    let previousSnapshot = previousSnapshotFor(item)
    if (item.pointMapProjectId && item.pointMapRevision !== previousSnapshot?.pointMapRevision) previousSnapshot = undefined
    const quantity = Number(item.quantity || 1)
    const unitPrice = Number(item.price || 0)
    const finalUnitPrice = lineAmount(unitPrice, 1, Number(item.discount ?? 100))
    const subtotalAmount = lineAmount(unitPrice, quantity)
    const finalAmount = lineAmount(unitPrice, quantity, Number(item.discount ?? 100))
    const refreshedImage = input.refreshProductImages === true ? usableProductImage(catalog.get(item.productId)?.image) : undefined
    const savedItemCost = itemCost(item)
    // 报价上手改的价格记为该项目对此商品的专属价格，之后同步报价时沿用。
    if (unitPrice > 0 && isUuid(item.productId)) {
      await client.query(
        `insert into project_product_prices (project_id, product_id, unit_price, cost_price, updated_by)
         values ($1::uuid, $2::uuid, $3, $4, $5)
         on conflict (project_id, product_id) do update set unit_price = excluded.unit_price, cost_price = excluded.cost_price, updated_at = now(), updated_by = excluded.updated_by`,
        [resolvedProject.id, item.productId, unitPrice, savedItemCost, actorUserId],
      )
    }

    await client.query(
      `
      insert into quote_items (
        created_by, updated_by, status, quote_id, product_id, quantity, unit_price,
        sort_order, room, name, unit, final_unit_price, cost_price,
        subtotal_amount, final_amount, note, point_map_project_id, point_ids, point_map_revision, product_snapshot
      )
      values ($1, $1, 'active', $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid, $16::jsonb, $17, $18::jsonb)
      `,
      [
        actorUserId,
        quoteId,
        item.productId,
        quantity,
        unitPrice,
        index,
        item.room,
        item.name,
        item.unit,
        finalUnitPrice,
        savedItemCost,
        subtotalAmount,
        finalAmount,
        item.spec,
        item.pointMapProjectId === resolvedProject.id ? resolvedProject.id : null,
        JSON.stringify(item.pointMapProjectId === resolvedProject.id && Array.isArray(item.pointIds) ? item.pointIds.filter((id) => typeof id === "string").slice(0, 2000) : []),
        item.pointMapProjectId ? item.pointMapRevision : null,
        JSON.stringify({
          ...(previousSnapshot ?? {}),
          version: 1,
          origin: previousSnapshot?.origin ?? "quote-save",
          capturedAt: previousSnapshot?.capturedAt ?? new Date().toISOString(),
          name: item.name, spec: item.spec, unit: item.unit,
          quotationVerification: sourceVerifications.get(JSON.stringify([item.productId, item.room])) ??
            (previousSnapshot ? quoteVerification({ productSnapshot: previousSnapshot }) : catalogQuotationVerification(catalog.get(item.productId))),
          sku: previousSnapshot ? previousSnapshot.sku ?? "" : catalog.get(item.productId)?.sku ?? "",
          category: previousSnapshot ? previousSnapshot.category ?? "" : catalog.get(item.productId)?.category ?? "其他",
          image: refreshedImage ?? (previousSnapshot ? previousSnapshot.image ?? "/placeholder.svg" : catalog.get(item.productId)?.image ?? "/placeholder.svg"),
          ...(item.pointMapProjectId ? { pointMapRevision: item.pointMapRevision, mappingRevision: catalog.get(item.productId)?.mappingRevision, deviceTypeId: catalog.get(item.productId)?.deviceTypeId, specs: catalog.get(item.productId)?.specs } : {}),
        }),
      ],
    )
  }

  await client.query(
    `
    update projects
    set quote_no = $2,
        quote_amount = $3,
        updated_by = $4,
        updated_at = now()
    where id = $1::uuid
    `,
    [resolvedProject.id, quoteNo, total, actorUserId],
  )

  const occurredAt = dependencies.now?.() ?? new Date()
  const durationSeconds = secondsBetween(resolvedProject.createdAt, occurredAt)
  await tryRecordActivity(client, {
    action: isExistingQuote ? "quote.updated" : "quote.created",
    actorId: actorUserId,
    actorName,
    description: `${actorName} ${isExistingQuote ? "\u66f4\u65b0" : "\u751f\u6210"} ${quoteNo}\uff0c\u4ece\u9879\u76ee\u521b\u5efa\u5230\u62a5\u4ef7\u7528\u4e86 ${formatActivityDuration(durationSeconds)}\uff0c\u62a5\u4ef7\u91d1\u989d ${money(total)}\u3002`,
    durationSeconds,
    entityId: quoteId,
    entityLabel: quoteNo,
    entityType: "quote",
    metadata: {
      discount,
      itemCount: validItems.length,
      projectId: resolvedProject.id,
      projectName: resolvedProject.name,
      quoteNo,
      roomCount: rooms.length,
      subtotal,
      total,
    },
    occurredAt,
    title: `${resolvedProject.name} \u62a5\u4ef7\u5df2${isExistingQuote ? "\u66f4\u65b0" : "\u751f\u6210"}`,
  })

  return {
    id: quoteId,
    ...(savedQuote.rows[0].updatedAt ? { updatedAt: new Date(savedQuote.rows[0].updatedAt).toISOString() } : {}),
    quoteNo: savedQuote.rows[0].quote_no,
    savedItems: validItems.length,
    skippedItems: items.length - validItems.length,
    ...(pointMapRevision !== undefined ? { pointMapRevision } : {}),
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function makeQuoteNo() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `QT-${date}-${suffix}`
}

function formatActivityDuration(seconds: number) {
  if (seconds < 60 * 60) {
    return "1 \u5c0f\u65f6\u5185"
  }

  if (seconds < 24 * 60 * 60) {
    return `${Math.max(1, Math.round(seconds / 60 / 60))} \u5c0f\u65f6`
  }

  return `${Math.max(1, Math.round(seconds / 60 / 60 / 24))} \u5929`
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value)
}
