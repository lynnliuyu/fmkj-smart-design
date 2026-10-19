export type WorkOrderType = "measure" | "install" | "commission" | "after_sale"
export type WorkOrderStatus = "draft" | "scheduled" | "in_progress" | "done" | "canceled"
export type WorkOrderPriority = "low" | "normal" | "high"
export type WorkPricingMode = "fixed" | "per_unit" | "per_product"
export type WorkOrgPricingKind = "override" | "custom"

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  measure: "复尺",
  install: "安装",
  commission: "调试",
  after_sale: "售后",
}

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "待派单",
  scheduled: "已派单",
  in_progress: "进行中",
  done: "已完成",
  canceled: "已取消",
}

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
}

export const PRICING_MODE_LABELS: Record<WorkPricingMode, string> = {
  fixed: "固定工费",
  per_unit: "按数量×单价",
  per_product: "按携带产品数",
}

export type WorkOrder = {
  id: string
  code: string
  projectId: string
  projectName: string | null
  projectCode: string | null
  title: string
  workTypes: WorkOrderType[]
  status: WorkOrderStatus
  priority: WorkOrderPriority
  assigneeId: string | null
  assigneeName: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  completedBy: string | null
  completedByName: string | null
  completionContent: string | null
  completionNote: string | null
  finalFeeCents: number
  items: WorkOrderItem[]
  workLines: WorkOrderWorkLine[]
  photoIds: string[]
  createdAt: string
  createdBy: string | null
}

export type WorkOrderItem = {
  id: string
  workOrderId: string
  productId: string | null
  quoteItemId: string | null
  name: string
  spec: string | null
  unit: string
  quantity: number
  actualQuantity: number | null
  room: string | null
  unitPriceCents: number
  sortOrder: number
}

export type WorkOrderWorkLine = {
  id: string
  workOrderId: string
  catalogCode: string | null
  workType: WorkOrderType
  name: string
  description: string | null
  pricingMode: WorkPricingMode
  quantity: number
  unitName: string
  unitPriceCents: number
  lineTotalCents: number
  note: string | null
  sortOrder: number
}

export type WorkPricingCatalogEntry = {
  id: string
  workType: WorkOrderType
  code: string
  catalogCode?: string | null
  name: string
  description: string | null
  pricingMode: WorkPricingMode
  unitPriceCents: number
  unitName: string
  sortOrder: number
  isSystem: boolean
  isHidden: boolean
  isOverride: boolean
}

export type CreateWorkOrderInput = {
  projectId: string
  title: string
  workTypes: WorkOrderType[]
  priority?: WorkOrderPriority
  assigneeId?: string | null
  scheduledAt?: string | null
  items: Array<{
    productId?: string | null
    quoteItemId?: string | null
    name: string
    spec?: string | null
    unit?: string
    quantity?: number
    room?: string | null
    unitPriceCents?: number
  }>
}

export type CompleteWorkOrderInput = {
  content: string
  note?: string
  workLines: Array<{
    catalogCode?: string | null
    workType: WorkOrderType
    name: string
    description?: string | null
    pricingMode: WorkPricingMode
    quantity?: number
    unitName?: string
    unitPriceCents: number
    note?: string | null
    sortOrder?: number
  }>
  actualQuantities?: Array<{ itemId: string; actualQuantity: number }>
  photoIds?: string[]
}

export class WorkOrderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code)
  }
}

const ALL_WORK_TYPES: WorkOrderType[] = ["measure", "install", "commission", "after_sale"]

export function isWorkOrderType(value: string): value is WorkOrderType {
  return (ALL_WORK_TYPES as string[]).includes(value)
}

export function normalizeWorkTypes(values: unknown[]): WorkOrderType[] {
  const seen = new Set<WorkOrderType>()
  for (const value of values) {
    const cleaned = String(value ?? "").trim()
    if (isWorkOrderType(cleaned) && !seen.has(cleaned)) seen.add(cleaned)
  }
  return Array.from(seen)
}

export function computeLineTotal(
  mode: WorkPricingMode,
  quantity: number,
  unitPriceCents: number,
  productCount: number,
): number {
  if (mode === "fixed") return Math.max(0, unitPriceCents)
  if (mode === "per_unit") return Math.max(0, Math.round(quantity * unitPriceCents))
  if (mode === "per_product") return Math.max(0, Math.round(productCount * unitPriceCents))
  return 0
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const value = Math.abs(Math.round(cents)) / 100
  return `${sign}¥${value.toFixed(2)}`
}