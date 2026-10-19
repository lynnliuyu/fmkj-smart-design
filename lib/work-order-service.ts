import type { Pool } from "pg"

import { getPool } from "./server-db"
import { projectVisibilityWhere } from "./project-access"
import type { AccountContext } from "./account-context"
import {
  computeLineTotal,
  formatCents,
  isWorkOrderType,
  normalizeWorkTypes,
  WorkOrderError,
  WORK_ORDER_TYPE_LABELS,
  type CompleteWorkOrderInput,
  type CreateWorkOrderInput,
  type WorkOrder,
  type WorkOrderItem,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderType,
  type WorkOrderWorkLine,
  type WorkPricingCatalogEntry,
  type WorkPricingMode,
} from "./work-order-shared"

export {
  computeLineTotal,
  formatCents,
  isWorkOrderType,
  normalizeWorkTypes,
  WorkOrderError,
  WORK_ORDER_TYPE_LABELS,
}
export type {
  CompleteWorkOrderInput,
  CreateWorkOrderInput,
  WorkOrder,
  WorkOrderItem,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderType,
  WorkOrderWorkLine,
  WorkPricingCatalogEntry,
  WorkPricingMode,
  WorkOrgPricingKind,
} from "./work-order-shared"

// Re-exported for backwards compatibility with existing imports of WORK_ORDER_STATUS_LABELS / WORK_ORDER_PRIORITY_LABELS / PRICING_MODE_LABELS
export {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
  PRICING_MODE_LABELS,
} from "./work-order-shared"

const ALL_WORK_TYPES: WorkOrderType[] = ["measure", "install", "commission", "after_sale"]

export async function listWorkOrdersForUser(
  context: AccountContext,
  filter: { status?: WorkOrderStatus | "all"; workType?: WorkOrderType | "all"; projectId?: string } = {},
): Promise<WorkOrder[]> {
  const visibility = projectVisibilityWhere(context, 1)
  const conditions: string[] = [`w.deleted_at is null`, `(${visibility.where})`]
  const params: unknown[] = []

  if (filter.status && filter.status !== "all") {
    params.push(filter.status)
    conditions.push(`w.status = $${params.length + visibility.params.length}`)
  }
  if (filter.workType && filter.workType !== "all") {
    params.push(filter.workType)
    conditions.push(`$${params.length + visibility.params.length}::text = any(w.work_types)`)
  }
  if (filter.projectId) {
    params.push(filter.projectId)
    conditions.push(`w.project_id = $${params.length + visibility.params.length}::uuid`)
  }

  const sql = `
    select
      w.id::text as id,
      w.code,
      w.project_id::text as "projectId",
      p.name as "projectName",
      p.code as "projectCode",
      w.title,
      w.work_types::text[] as "workTypes",
      w.status::text as status,
      w.priority::text as priority,
      w.assignee_id::text as "assigneeId",
      assignee.name as "assigneeName",
      w.scheduled_at as "scheduledAt",
      w.started_at as "startedAt",
      w.completed_at as "completedAt",
      w.completed_by::text as "completedBy",
      completed_by_user.name as "completedByName",
      w.completion_content as "completionContent",
      w.completion_note as "completionNote",
      w.final_fee_cents as "finalFeeCents",
      w.created_by::text as "createdBy",
      w.created_at as "createdAt",
      (
        select json_agg(json_build_object(
          'id', i.id::text, 'name', i.name, 'unit', i.unit,
          'quantity', i.quantity::float8, 'room', i.room
        ))
        from work_order_items i
        where i.work_order_id = w.id
      ) as items
    from work_orders w
    join projects p on p.id = w.project_id
    left join users assignee on assignee.id = w.assignee_id
    left join users completed_by_user on completed_by_user.id = w.completed_by
    where ${conditions.join(" and ")}
    order by w.created_at desc
    limit 200
  `
  const result = await getPool().query(sql, [...visibility.params, ...params])
  for (const row of result.rows) {
    if (!Array.isArray(row.items)) row.items = [] as never
    if (!Array.isArray(row.workLines)) row.workLines = [] as never
    if (!Array.isArray(row.photoIds)) row.photoIds = [] as never
    row.workTypes = normalizeWorkTypes(Array.isArray(row.workTypes) ? row.workTypes : [])
  }
  return result.rows as WorkOrder[]
}

export async function getWorkOrderDetail(
  context: AccountContext,
  workOrderId: string,
): Promise<WorkOrder> {
  const visibility = projectVisibilityWhere(context, 1)
  const orderResult = await getPool().query(
    `
    select
      w.id::text as id,
      w.code,
      w.project_id::text as "projectId",
      p.name as "projectName",
      p.code as "projectCode",
      w.title,
      w.work_types::text[] as "workTypes",
      w.status::text as status,
      w.priority::text as priority,
      w.assignee_id::text as "assigneeId",
      assignee.name as "assigneeName",
      w.scheduled_at as "scheduledAt",
      w.started_at as "startedAt",
      w.completed_at as "completedAt",
      w.completed_by::text as "completedBy",
      completed_by_user.name as "completedByName",
      w.completion_content as "completionContent",
      w.completion_note as "completionNote",
      w.final_fee_cents as "finalFeeCents",
      w.created_by::text as "createdBy",
      w.created_at as "createdAt"
    from work_orders w
    join projects p on p.id = w.project_id
    left join users assignee on assignee.id = w.assignee_id
    left join users completed_by_user on completed_by_user.id = w.completed_by
    where w.id = $1::uuid
      and w.deleted_at is null
      and (${visibility.where})
    `,
    [workOrderId, ...visibility.params],
  )
  const order = orderResult.rows[0] as WorkOrder | undefined
  if (!order) throw new WorkOrderError("WORK_ORDER_NOT_FOUND", 404)

  const [items, workLines, photos] = await Promise.all([
    getPool().query(
      `select
        i.id::text as id,
        i.work_order_id::text as "workOrderId",
        i.product_id::text as "productId",
        i.quote_item_id::text as "quoteItemId",
        i.name,
        i.spec,
        i.unit,
        i.quantity::float8 as quantity,
        i.actual_quantity::float8 as "actualQuantity",
        i.room,
        i.unit_price_cents as "unitPriceCents",
        i.sort_order as "sortOrder"
      from work_order_items i
      where i.work_order_id = $1::uuid
      order by i.sort_order`,
      [workOrderId],
    ),
    getPool().query(
      `select
        l.id::text as id,
        l.work_order_id::text as "workOrderId",
        l.catalog_code as "catalogCode",
        l.work_type::text as "workType",
        l.name,
        l.description,
        l.pricing_mode::text as "pricingMode",
        l.quantity::float8 as quantity,
        l.unit_name as "unitName",
        l.unit_price_cents as "unitPriceCents",
        l.line_total_cents as "lineTotalCents",
        l.note,
        l.sort_order as "sortOrder"
      from work_order_work_lines l
      where l.work_order_id = $1::uuid
      order by l.sort_order`,
      [workOrderId],
    ),
    getPool().query(
      `select photo_id::text as "photoId" from work_order_photos where work_order_id = $1::uuid`,
      [workOrderId],
    ),
  ])

  order.items = items.rows as WorkOrderItem[]
  order.workLines = workLines.rows as WorkOrderWorkLine[]
  order.photoIds = photos.rows.map((row) => row.photoId)
  return order
}

export async function createWorkOrder(
  context: AccountContext,
  input: CreateWorkOrderInput,
): Promise<WorkOrder> {
  const projectId = String(input.projectId ?? "").trim()
  if (!projectId) throw new WorkOrderError("PROJECT_REQUIRED", 400)
  if (!input.workTypes.length) throw new WorkOrderError("WORK_TYPE_REQUIRED", 400)
  if (!input.items.length) throw new WorkOrderError("WORK_ITEMS_REQUIRED", 400)

  const visibility = projectVisibilityWhere(context, 1)
  const accessResult = await getPool().query(
    `select 1 from projects p where p.id = $1::uuid and p.deleted_at is null and (${visibility.where})`,
    [projectId, ...visibility.params],
  )
  if (!accessResult.rowCount) throw new WorkOrderError("PROJECT_NOT_ACCESSIBLE", 404)

  const code = await nextWorkOrderCode(getPool())
  const workTypes = input.workTypes
  const priority = normalizePriority(input.priority)
  const assigneeId = input.assigneeId ? String(input.assigneeId).trim() : null
  const scheduledAt = input.scheduledAt ? parseDate(input.scheduledAt) : null

  const client = await getPool().connect()
  try {
    await client.query("begin")
    const orderRow = await client.query(
      `insert into work_orders (code, project_id, title, work_types, priority, assignee_id, scheduled_at, created_by)
       values ($1, $2::uuid, $3, $4::work_order_type[], $5::work_order_priority, $6::uuid, $7, $8::uuid)
       returning id::text`,
      [
        code,
        projectId,
        String(input.title).trim() || `工单 ${code}`,
        workTypes,
        priority,
        assigneeId,
        scheduledAt,
        context.user.userId,
      ],
    )
    const workOrderId = orderRow.rows[0].id

    let sortOrder = 0
    for (const item of input.items) {
      await client.query(
        `insert into work_order_items (work_order_id, product_id, quote_item_id, name, spec, unit, quantity, room, unit_price_cents, sort_order)
         values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
        [
          workOrderId,
          item.productId || null,
          item.quoteItemId || null,
          String(item.name).trim(),
          item.spec || null,
          item.unit || "个",
          Number(item.quantity ?? 1),
          item.room || null,
          Number(item.unitPriceCents ?? 0),
          sortOrder,
        ],
      )
      sortOrder += 1
    }

    await client.query("commit")
    return getWorkOrderDetail(context, workOrderId)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function patchWorkOrder(
  context: AccountContext,
  workOrderId: string,
  patch: {
    status?: WorkOrderStatus
    priority?: WorkOrderPriority
    assigneeId?: string | null
    scheduledAt?: string | null
    title?: string
  },
): Promise<WorkOrder> {
  const existing = await getWorkOrderDetail(context, workOrderId)
  if (existing.status === "done") {
    throw new WorkOrderError("WORK_ORDER_LOCKED", 400)
  }

  const sets: string[] = []
  const params: unknown[] = [workOrderId]
  if (patch.status) {
    params.push(patch.status)
    sets.push(`status = $${params.length}::work_order_status`)
  }
  if (patch.priority) {
    params.push(patch.priority)
    sets.push(`priority = $${params.length}::work_order_priority`)
  }
  if (patch.assigneeId !== undefined) {
    params.push(patch.assigneeId)
    sets.push(`assignee_id = $${params.length}::uuid`)
  }
  if (patch.scheduledAt !== undefined) {
    params.push(patch.scheduledAt ? parseDate(patch.scheduledAt) : null)
    sets.push(`scheduled_at = $${params.length}`)
  }
  if (patch.title) {
    params.push(String(patch.title).trim())
    sets.push(`title = $${params.length}`)
  }
  if (!sets.length) return existing

  sets.push(`updated_at = now()`)
  await getPool().query(`update work_orders set ${sets.join(", ")} where id = $1::uuid`, params)
  return getWorkOrderDetail(context, workOrderId)
}

export async function completeWorkOrder(
  context: AccountContext,
  workOrderId: string,
  input: CompleteWorkOrderInput,
): Promise<WorkOrder> {
  const existing = await getWorkOrderDetail(context, workOrderId)
  if (existing.status === "done") throw new WorkOrderError("WORK_ORDER_ALREADY_DONE", 400)
  if (existing.status === "canceled") throw new WorkOrderError("WORK_ORDER_CANCELED", 400)
  if (existing.status === "draft") throw new WorkOrderError("WORK_ORDER_NOT_STARTED", 400)

  const client = await getPool().connect()
  try {
    await client.query("begin")

    const productCount = existing.items.length
    const totalFeeCents = input.workLines.reduce(
      (sum, line) => sum + computeLineTotal(line.pricingMode, Number(line.quantity ?? 0), line.unitPriceCents, productCount),
      0,
    )

    await client.query(`delete from work_order_work_lines where work_order_id = $1::uuid`, [workOrderId])

    let sortOrder = 0
    for (const line of input.workLines) {
      const quantity = Number(line.quantity ?? 0)
      const lineTotal = computeLineTotal(line.pricingMode, quantity, line.unitPriceCents, productCount)
      await client.query(
        `insert into work_order_work_lines (
          work_order_id, catalog_code, work_type, name, description, pricing_mode, quantity, unit_name, unit_price_cents, line_total_cents, note, sort_order
        ) values ($1::uuid, $2, $3::work_order_type, $4, $5, $6::work_pricing_mode, $7, $8, $9, $10, $11, $12)`,
        [
          workOrderId,
          line.catalogCode || null,
          line.workType,
          String(line.name).trim(),
          line.description || null,
          line.pricingMode,
          quantity,
          line.unitName || "次",
          line.unitPriceCents,
          lineTotal,
          line.note || null,
          line.sortOrder ?? sortOrder,
        ],
      )
      sortOrder += 1
    }

    for (const actual of input.actualQuantities ?? []) {
      await client.query(
        `update work_order_items set actual_quantity = $2 where id = $1::uuid and work_order_id = $3::uuid`,
        [actual.itemId, Number(actual.actualQuantity), workOrderId],
      )
    }

    if (input.photoIds?.length) {
      for (const photoId of input.photoIds) {
        await client.query(
          `insert into work_order_photos (work_order_id, photo_id) values ($1::uuid, $2::uuid) on conflict do nothing`,
          [workOrderId, photoId],
        )
      }
    }

    await client.query(
      `update work_orders
       set status = 'done',
           completed_at = now(),
           completed_by = $2::uuid,
           completion_content = $3,
           completion_note = $4,
           final_fee_cents = $5,
           updated_at = now()
       where id = $1::uuid`,
      [
        workOrderId,
        context.user.userId,
        String(input.content ?? "").trim() || null,
        input.note ? String(input.note).trim() : null,
        totalFeeCents,
      ],
    )

    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }

  return getWorkOrderDetail(context, workOrderId)
}

export async function generateCompletionDraft(
  context: AccountContext,
  workOrderId: string,
): Promise<CompleteWorkOrderInput> {
  const order = await getWorkOrderDetail(context, workOrderId)
  const pricing = await listPricingForOrganization(context, order.workTypes)
  const productCount = order.items.length

  const draftLines = pricing.map((entry, index) => {
    const quantity = entry.pricingMode === "per_unit" ? Math.max(1, productCount) : 1
    const lineTotal = computeLineTotal(entry.pricingMode, quantity, entry.unitPriceCents, productCount)
    return {
      catalogCode: entry.code,
      workType: entry.workType,
      name: entry.name,
      description: entry.description,
      pricingMode: entry.pricingMode,
      quantity,
      unitName: entry.unitName,
      unitPriceCents: entry.unitPriceCents,
      note: null,
      sortOrder: index,
      lineTotalCents: lineTotal,
    }
  })

  const autoContent = buildAutoCompletionContent(order, draftLines)
  return {
    content: autoContent,
    note: "",
    workLines: draftLines.map((line) => ({
      catalogCode: line.catalogCode,
      workType: line.workType,
      name: line.name,
      description: line.description,
      pricingMode: line.pricingMode,
      quantity: line.quantity,
      unitName: line.unitName,
      unitPriceCents: line.unitPriceCents,
      note: line.note,
      sortOrder: line.sortOrder,
    })),
    actualQuantities: order.items.map((item) => ({
      itemId: item.id,
      actualQuantity: item.quantity,
    })),
    photoIds: [],
  }
}

function buildAutoCompletionContent(
  order: WorkOrder,
  lines: Array<{ name: string; pricingMode: WorkPricingMode; quantity: number; unitPriceCents: number; lineTotalCents: number }>,
): string {
  const typeLabels = order.workTypes.map((type) => WORK_ORDER_TYPE_LABELS[type]).join("/")
  const lineSummary = lines
    .map((line) => `· ${line.name}：${formatCents(line.lineTotalCents)}`)
    .join("\n")
  return [
    `工单 ${order.code} 完成。`,
    `工作类型：${typeLabels}`,
    `携带产品 ${order.items.length} 项。`,
    `工作明细：`,
    lineSummary,
  ].join("\n")
}

export async function listPricingForOrganization(
  context: AccountContext,
  workTypes: WorkOrderType[] = ALL_WORK_TYPES,
): Promise<WorkPricingCatalogEntry[]> {
  const orgId = context.organization?.id
  const types = workTypes.length ? workTypes : ALL_WORK_TYPES

  const systemRows = await getPool().query(
    `select
       c.id::text as id,
       c.work_type::text as "workType",
       c.code,
       c.name,
       c.description,
       c.pricing_mode::text as "pricingMode",
       c.default_unit_price_cents as "unitPriceCents",
       c.unit_name as "unitName",
       c.sort_order as "sortOrder",
       true as "isSystem",
       false as "isHidden",
       false as "isOverride"
     from work_pricing_catalog c
     where c.is_active = true
       and c.work_type = any($1::work_order_type[])
     order by c.work_type, c.sort_order`,
    [types],
  )

  const result: WorkPricingCatalogEntry[] = systemRows.rows.map((row) => ({ ...row } as WorkPricingCatalogEntry))

  if (orgId) {
    const overrides = await getPool().query(
      `select
         o.id::text as id,
         o.catalog_code as "catalogCode",
         o.work_type::text as "workType",
         o.name,
         o.description,
         o.pricing_mode::text as "pricingMode",
         o.unit_price_cents as "unitPriceCents",
         o.unit_name as "unitName",
         coalesce(o.sort_override, c.sort_order) as "sortOrder",
         false as "isSystem",
         o.is_hidden as "isHidden",
         true as "isOverride"
       from work_org_pricing o
       left join work_pricing_catalog c on c.code = o.catalog_code
       where o.organization_id = $1::uuid
         and o.kind = 'override'
         and o.work_type = any($2::work_order_type[])`,
      [orgId, types],
    )

    for (const override of overrides.rows as WorkPricingCatalogEntry[]) {
      const idx = result.findIndex((entry) => entry.code === override.catalogCode)
      if (idx >= 0) {
        result[idx] = { ...result[idx], ...override, code: result[idx].code }
      }
    }

    const customRows = await getPool().query(
      `select
         o.id::text as id,
         o.catalog_code as code,
         o.work_type::text as "workType",
         o.name,
         o.description,
         o.pricing_mode::text as "pricingMode",
         o.unit_price_cents as "unitPriceCents",
         o.unit_name as "unitName",
         o.sort_override as "sortOrder",
         false as "isSystem",
         o.is_hidden as "isHidden",
         false as "isOverride"
       from work_org_pricing o
       where o.organization_id = $1::uuid
         and o.kind = 'custom'
         and o.is_active = true
         and o.work_type = any($2::work_order_type[])`,
      [orgId, types],
    )
    for (const custom of customRows.rows as WorkPricingCatalogEntry[]) {
      if (!custom.isHidden) result.push(custom)
    }
  }

  return result
    .filter((entry) => !entry.isHidden)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export type UpsertPricingOverrideInput = {
  catalogCode: string
  name?: string
  pricingMode?: WorkPricingMode
  unitPriceCents?: number
  unitName?: string
  isHidden?: boolean
}

export async function upsertPricingOverride(
  context: AccountContext,
  input: UpsertPricingOverrideInput,
): Promise<void> {
  if (!context.organization) throw new WorkOrderError("ORGANIZATION_REQUIRED", 400)
  if (context.account.type !== "ENTERPRISE_OWNER" && !context.account.isSuperAdmin) {
    throw new WorkOrderError("ROLE_PERMISSION_DENIED", 403)
  }

  const catalog = await getPool().query(
    `select work_type::text as work_type from work_pricing_catalog where code = $1`,
    [input.catalogCode],
  )
  if (!catalog.rowCount) throw new WorkOrderError("CATALOG_NOT_FOUND", 404)

  await getPool().query(
    `insert into work_org_pricing (
       organization_id, kind, catalog_code, work_type, name, pricing_mode,
       unit_price_cents, unit_name, is_hidden, is_active, created_by, updated_at
     )
     values ($1::uuid, 'override', $2, $3::work_order_type, $4, $5::work_pricing_mode, $6, $7, $8, true, $9::uuid, now())
     on conflict (organization_id, catalog_code) do update set
       name = excluded.name,
       pricing_mode = excluded.pricing_mode,
       unit_price_cents = excluded.unit_price_cents,
       unit_name = excluded.unit_name,
       is_hidden = excluded.is_hidden,
       updated_at = now()`,
    [
      context.organization.id,
      input.catalogCode,
      catalog.rows[0].work_type,
      input.name ?? "",
      input.pricingMode ?? "fixed",
      input.unitPriceCents ?? 0,
      input.unitName ?? "次",
      input.isHidden ?? false,
      context.user.userId,
    ],
  )
}

export type AddCustomPricingItemInput = {
  workType: WorkOrderType
  name: string
  description?: string
  pricingMode: WorkPricingMode
  unitPriceCents: number
  unitName?: string
}

export async function addCustomPricingItem(
  context: AccountContext,
  input: AddCustomPricingItemInput,
): Promise<void> {
  if (!context.organization) throw new WorkOrderError("ORGANIZATION_REQUIRED", 400)
  if (context.account.type !== "ENTERPRISE_OWNER" && !context.account.isSuperAdmin) {
    throw new WorkOrderError("ROLE_PERMISSION_DENIED", 403)
  }
  if (!input.name.trim()) throw new WorkOrderError("NAME_REQUIRED", 400)

  const code = `custom.${context.organization.id}.${Date.now()}`
  await getPool().query(
    `insert into work_org_pricing (
       organization_id, kind, catalog_code, work_type, name, description,
       pricing_mode, unit_price_cents, unit_name, is_active, created_by
     )
     values ($1::uuid, 'custom', $2, $3::work_order_type, $4, $5, $6::work_pricing_mode, $7, $8, true, $9::uuid)`,
    [
      context.organization.id,
      code,
      input.workType,
      input.name.trim(),
      input.description || null,
      input.pricingMode,
      input.unitPriceCents,
      input.unitName || "次",
      context.user.userId,
    ],
  )
}

export async function deleteCustomPricingItem(context: AccountContext, id: string): Promise<void> {
  if (!context.organization) throw new WorkOrderError("ORGANIZATION_REQUIRED", 400)
  if (context.account.type !== "ENTERPRISE_OWNER" && !context.account.isSuperAdmin) {
    throw new WorkOrderError("ROLE_PERMISSION_DENIED", 403)
  }
  await getPool().query(
    `delete from work_org_pricing
     where id = $1::uuid
       and organization_id = $2::uuid
       and kind = 'custom'`,
    [id, context.organization.id],
  )
}

async function nextWorkOrderCode(pool: Pool): Promise<string> {
  const result = await pool.query(
    `select count(*)::int + 1 as next from work_orders where created_at >= date_trunc('year', now())`,
  )
  const seq = String(result.rows[0].next).padStart(4, "0")
  const year = new Date().getFullYear()
  return `WO-${year}-${seq}`
}

function normalizePriority(value?: WorkOrderPriority): WorkOrderPriority {
  if (value === "low" || value === "high") return value
  return "normal"
}

function parseDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new WorkOrderError("INVALID_DATE", 400)
  return date.toISOString()
}
