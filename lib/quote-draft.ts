"use client"

import type { PointMapStorage } from "./point-map-plan"
import type { ProductSelectionFields } from "./product-selection"
import type { ProductVisualAsset } from "./product-visual-assets"

export const QUOTE_DRAFT_STORAGE_KEY = "fmkj:quote-draft-items"
export const POINT_MAP_QUOTE_SNAPSHOT_PREFIX = "fmkj:point-map-quote:"
/** Same-tab notification so an open quote page can re-merge as soon as a point-map sync is saved. */
export const POINT_MAP_QUOTE_SNAPSHOT_EVENT = "fmkj:point-map-quote-updated"

export function writePointMapQuoteSnapshot(snapshot: PointMapQuoteSnapshot, storage: PointMapStorage | undefined = quoteStorage()) {
  if (!storage) return
  storage.setItem(POINT_MAP_QUOTE_SNAPSHOT_PREFIX + snapshot.projectId, JSON.stringify(snapshot))
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(POINT_MAP_QUOTE_SNAPSHOT_EVENT, { detail: { projectId: snapshot.projectId } }))
}

export type QuoteDraftProduct = ProductSelectionFields & {
  id: string
  name: string
  spec: string
  category: string
  unit: string
  price: number
  cost: number
  image: string
  sku?: string
  status?: string
  productSnapshot?: Record<string, unknown>
  visualAsset?: ProductVisualAsset | null
}

export type QuoteDraftItem = QuoteDraftProduct & {
  project: string
  projectId?: string
  room: string
  quantity: number
  pointMapProjectId?: string
  pointIds?: string[]
  pointMapRevision?: number
}

export type PointMapQuoteSnapshot = { projectId: string; revision?: number; items: QuoteDraftItem[] }

export function consumePointMapQuoteSnapshot(projectId: string, storage: PointMapStorage | undefined = quoteStorage()): PointMapQuoteSnapshot | null {
  if (!storage) return null
  const key = POINT_MAP_QUOTE_SNAPSHOT_PREFIX + projectId
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const snapshot = JSON.parse(raw) as PointMapQuoteSnapshot
    if (snapshot.projectId !== projectId || !Array.isArray(snapshot.items) || snapshot.items.some((item) => !isQuoteDraftItem(item) || item.pointMapProjectId !== projectId)) return null
    storage.setItem(key, "")
    return snapshot
  } catch { return null }
}

export function addQuoteDraftProduct(
  product: QuoteDraftProduct,
  room = "全屋",
  project = ""
) {
  if (typeof window === "undefined") {
    return 0
  }

  const items = readQuoteDraftItems()
  const existing = items.find(
    (item) =>
      item.id === product.id && item.room === room && item.project === project
  )

  if (existing) {
    existing.quantity += 1
  } else {
    items.push({ ...product, project, room, quantity: 1 })
  }

  window.localStorage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(items))

  return existing?.quantity ?? 1
}

export function consumeQuoteDraftItems(options: { projectId?: string; projectName?: string; storage?: PointMapStorage } = {}) {
  const storage = options.storage ?? quoteStorage()
  if (!storage) return []
  const items = readQuoteDraftItems(storage)
  const matches = (item: QuoteDraftItem) => !options.projectId || (item.projectId ? item.projectId === options.projectId : !item.project || item.project === options.projectName)
  const selected = items.filter(matches)
  storage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify(items.filter((item) => !matches(item))))
  return selected
}

function readQuoteDraftItems(storage: PointMapStorage | undefined = quoteStorage()): QuoteDraftItem[] {
  try {
    const raw = storage?.getItem(QUOTE_DRAFT_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as QuoteDraftItem[]) : []

    return Array.isArray(parsed) ? parsed.filter(isQuoteDraftItem) : []
  } catch {
    return []
  }
}

function quoteStorage(): PointMapStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage
}

function isQuoteDraftItem(item: QuoteDraftItem) {
  return Boolean(
    item &&
      item.id &&
      item.name &&
      item.unit &&
      item.room &&
      typeof item.price === "number" &&
      typeof item.cost === "number" &&
      typeof item.quantity === "number"
  )
}
