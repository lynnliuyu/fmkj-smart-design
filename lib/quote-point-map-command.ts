import {
  queuePointMapProduct,
  type PointMapStorage,
} from "./point-map-plan"
import type { QuoteDraftProduct } from "./quote-draft"
import { canExpandProductToPoints } from "./product-selection"

export type QuoteLineDraft = QuoteDraftProduct & {
  lineId: string
  room: string
  quantity: number
  discount: number
}

export type AddQuoteProductCommand = {
  product: QuoteDraftProduct
  room: string
  projectId?: string
  projectName?: string
  quantity?: number
  discount?: number
  syncPointMap?: boolean
  storage?: PointMapStorage
  createLineId?: () => string
}

export type QuoteProjectReference = {
  id?: string | null
  name?: string | null
}

export type AddQuoteProductSelectionCommand = {
  product: QuoteDraftProduct
  project: QuoteProjectReference
  room: string
  quantity?: number
  discount?: number
  syncPointMap?: boolean
  storage?: PointMapStorage
  createLineId?: () => string
}

export type AddQuoteProductResult = {
  line: QuoteLineDraft
  pointMapProjectId: string
  pointMapQueued: boolean
}

export async function addQuoteProductSelection(input: AddQuoteProductSelectionCommand): Promise<AddQuoteProductResult> {
  return addQuoteProductToPlan({
    createLineId: input.createLineId,
    discount: input.discount,
    product: input.product,
    projectId: resolveQuoteProjectKey(input.project),
    quantity: input.quantity,
    room: input.room,
    storage: input.storage,
    syncPointMap: input.syncPointMap,
  })
}

export async function addQuoteProductToPlan(input: AddQuoteProductCommand): Promise<AddQuoteProductResult> {
  const quantity = normalizeQuantity(input.quantity)
  const line = createQuoteLine(input.product, input.room, {
    createLineId: input.createLineId,
    discount: input.discount,
    quantity,
  })
  const pointMapProjectId = input.projectId || input.projectName || ""
  const shouldSyncPointMap = (input.syncPointMap ?? true) && canExpandProductToPoints(input.product) && Number.isInteger(quantity)

  if (shouldSyncPointMap && pointMapProjectId) {
    await queuePointMapProduct(
      {
        product: input.product,
        projectId: pointMapProjectId,
        quantity,
        room: input.room,
      },
      input.storage
    )
  }

  return {
    line,
    pointMapProjectId,
    pointMapQueued: Boolean(shouldSyncPointMap && pointMapProjectId),
  }
}

export function resolveQuoteProjectKey(project: QuoteProjectReference) {
  return String(project.id || project.name || "").trim()
}

export function createQuoteLine(
  product: QuoteDraftProduct,
  room: string,
  options: {
    createLineId?: () => string
    discount?: number
    quantity?: number
  } = {}
): QuoteLineDraft {
  return {
    ...product,
    discount: normalizeDiscount(options.discount),
    lineId: options.createLineId?.() ?? defaultLineId(product.id),
    quantity: normalizeQuantity(options.quantity),
    room,
  }
}

function normalizeQuantity(quantity = 1) {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

function normalizeDiscount(discount = 100) {
  return Math.max(0, Math.min(100, Number(discount) || 0))
}

function defaultLineId(productId: string) {
  return `${productId}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
