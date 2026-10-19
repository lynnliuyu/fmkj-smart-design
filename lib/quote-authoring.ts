import { defaultSellingPrice } from "./product-pricing"
import { createQuoteLine } from "./quote-point-map-command"
import type { PointMapQuoteSnapshot, QuoteDraftItem } from "./quote-draft"
import type { QuoteItemPayload } from "./quote-save"
import type { ProductSelectionFields } from "./product-selection"

export type QuoteGroupMode = "room" | "type" | "none"

export type QuoteProductOption = ProductSelectionFields & {
  id: string
  name: string
  spec: string
  brand?: string | null
  category: string
  unit: string
  price: number
  cost: number
  image: string
  sku?: string
  status?: string
  productSnapshot?: Record<string, unknown>
}

export type QuoteDatabaseProduct = ProductSelectionFields & {
  id: string
  name: string
  brand?: string | null
  platform?: string | null
  category?: string | null
  sku: string
  unit: string
  price: number
  cost?: number | null
  image?: string | null
  description?: string | null
}

export type QuoteProjectOption = {
  id: string
  name: string
  code?: string
  customer?: string
  createdAt?: string
  quoteAmount?: number | null
  stage?: string
}

export type QuoteLineItem = QuoteProductOption & {
  lineId: string
  room: string
  quantity: number
  discount: number
  pointMapProjectId?: string
  pointIds?: string[]
  pointMapRevision?: number
}

export function pointMapRevisionForQuote(items: readonly QuoteLineItem[]): number | undefined {
  const revisions = new Set(items.filter((item) => item.pointMapProjectId).map((item) => item.pointMapRevision))
  const revision = [...revisions][0]
  return revisions.size === 1 && Number.isSafeInteger(revision) && revision! > 0 ? revision : undefined
}

/** A successful server write acknowledges only the submitted changes, preserving later local edits. */
export function acknowledgeQuotePointChanges<T extends {
  projectKey: string
  items: QuoteLineItem[]
  pointMapRevision?: number
  pendingPointRemovals: string[]
  pendingPointRoomMoves: Array<{ pointIds: string[]; room: string }>
}>(current: T, submitted: T, savedRevision: number | undefined): T {
  if (current.projectKey !== submitted.projectKey) return current
  const revision = Math.max(current.pointMapRevision ?? 0, savedRevision ?? 0) || undefined
  const removed = new Set(submitted.pendingPointRemovals)
  return {
    ...current,
    pointMapRevision: revision,
    items: current.items.map((item) => item.pointMapProjectId && revision ? { ...item, pointMapRevision: revision } : item),
    pendingPointRemovals: current.pendingPointRemovals.filter((id) => !removed.has(id)),
    pendingPointRoomMoves: current.pendingPointRoomMoves.filter((move) => !submitted.pendingPointRoomMoves.includes(move)),
  }
}

export type SavedQuoteItem = QuoteProductOption & {
  room: string
  quantity: number
  discount: number
  pointMapProjectId?: string
  pointIds?: string[]
  pointMapRevision?: number
}

export function applyPointMapQuoteSnapshot(items: QuoteLineItem[], snapshot: PointMapQuoteSnapshot): QuoteLineItem[] {
  const previous = new Map(items.filter((item) => item.pointMapProjectId === snapshot.projectId).map((item) => [JSON.stringify([item.id, item.room]), item]))
  return [
    ...items.filter((item) => item.pointMapProjectId !== snapshot.projectId),
    ...snapshot.items.map((item) => {
      const existing = previous.get(JSON.stringify([item.id, item.room]))
      return { ...createLine(item, item.room, item.quantity), lineId: existing?.lineId ?? `point-map:${snapshot.projectId}:${item.id}:${item.room}`, price: existing?.price ?? item.price, cost: existing?.cost ?? item.cost, discount: existing?.discount ?? 100, pointMapProjectId: snapshot.projectId, pointIds: [...(item.pointIds ?? [])], pointMapRevision: item.pointMapRevision ?? snapshot.revision }
    }),
  ]
}

/** Loading-time edits win for manual rows; a point-map snapshot owns its device quantities and IDs. */
export function mergeQuoteDraftLoad(input: {
  savedItems?: SavedQuoteItem[]
  localItemsAtStart: QuoteLineItem[]
  localItemsNow: QuoteLineItem[]
  preserveLocalDraft?: boolean
  draftItems?: QuoteDraftItem[]
  pointMapSnapshot?: PointMapQuoteSnapshot | null
  roomChanges?: Array<{ from: string; to: string }>
}): QuoteLineItem[] {
  const occurrences = new Map<string, number>()
  const localGroups = new Map<string, QuoteLineItem[]>()
  for (const item of input.localItemsAtStart) {
    const key = JSON.stringify([item.id, item.room, item.pointMapProjectId ?? ""])
    localGroups.set(key, [...(localGroups.get(key) ?? []), item])
  }
  let loaded = input.savedItems === undefined || input.preserveLocalDraft
    ? input.localItemsAtStart
    : input.savedItems.map((item) => {
        const key = JSON.stringify([item.id, item.room, item.pointMapProjectId ?? ""])
        const occurrence = occurrences.get(key) ?? 0
        occurrences.set(key, occurrence + 1)
        return { ...item, lineId: localGroups.get(key)?.[occurrence]?.lineId ?? `saved-quote:${key}:${occurrence}` }
      })
  loaded = [...loaded, ...(input.draftItems ?? []).map((item) => ({
    ...createLine(item, item.room, item.quantity),
    ...(item.pointMapProjectId ? { pointMapProjectId: item.pointMapProjectId, pointIds: item.pointIds } : {}),
  }))]
  if (input.pointMapSnapshot) loaded = applyPointMapQuoteSnapshot(loaded, input.pointMapSnapshot)
  for (const change of input.roomChanges ?? []) {
    loaded = loaded.map((item) => item.room === change.from ? { ...item, room: change.to } : item)
  }

  const before = new Map(input.localItemsAtStart.map((item) => [item.lineId, item]))
  const currentIds = new Set(input.localItemsNow.map((item) => item.lineId))
  const removed = new Set(input.localItemsAtStart.filter((item) => !currentIds.has(item.lineId)).map((item) => item.lineId))
  const changed = new Map(input.localItemsNow.filter((item) => {
    const original = before.get(item.lineId)
    return !original || JSON.stringify(original) !== JSON.stringify(item)
  }).map((item) => [item.lineId, item]))
  const snapshotProjectId = input.pointMapSnapshot?.projectId
  const controlledBySnapshot = (item: QuoteLineItem) => Boolean(snapshotProjectId && (
    item.pointMapProjectId === snapshotProjectId || before.get(item.lineId)?.pointMapProjectId === snapshotProjectId
  ))
  const merged = loaded.filter((item) => !removed.has(item.lineId) || controlledBySnapshot(item)).map((item) => {
    const edited = changed.get(item.lineId)
    changed.delete(item.lineId)
    if (edited && controlledBySnapshot(item)) {
      return { ...item, price: edited.price, discount: edited.discount, cost: edited.cost }
    }
    return edited ?? item
  })
  // A late edit to an obsolete sourced row cannot recreate a removed device.
  return [...merged, ...[...changed.values()].filter((item) => !controlledBySnapshot(item))]
}

/** Keep point-map provenance through the quote-save API roundtrip. */
export function quoteItemsSavePayload(items: QuoteLineItem[]): QuoteItemPayload[] {
  return items.map((item) => ({
    cost: item.cost,
    discount: item.discount,
    name: item.name,
    price: item.price,
    productId: item.id,
    quantity: item.quantity,
    room: item.room,
    spec: item.spec,
    unit: item.unit,
    productSnapshot: item.productSnapshot,
    ...(item.pointMapProjectId ? { pointMapProjectId: item.pointMapProjectId, pointIds: [...(item.pointIds ?? [])], pointMapRevision: item.pointMapRevision } : {}),
  }))
}

export type SavedQuoteResponse = {
  data?: {
    id?: string
    updatedAt?: string
    quoteNo?: string
    status?: string
    subtotal?: number
    discount?: number
    total?: number
    installationFee?: number
    rooms?: string[]
    items?: SavedQuoteItem[]
  } | null
}

export type SavedQuoteExportSnapshot = {
  quoteNo: string
  status: string
  subtotal: number
  discountTotal: number
  total: number
  installationFee: number
  items: QuoteLineItem[]
  groups: Array<{ name: string; items: QuoteLineItem[] }>
}

/** Export only the server's saved quote; a later edit invalidates this export attempt. */
export async function prepareSavedQuoteExport(input: {
  saveDraft: () => Promise<boolean>
  captureIsCurrent: () => () => boolean
  loadSavedQuote: () => Promise<SavedQuoteResponse>
  groupMode: QuoteGroupMode
}): Promise<{ snapshot: SavedQuoteExportSnapshot; assertCurrent: () => void }> {
  if (!await input.saveDraft()) throw new Error("当前报价未完成保存，请确认保存成功后重新导出。")
  const isCurrent = input.captureIsCurrent()
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("导出期间报价又有修改或已切换项目，请重新导出以包含最新内容。")
  }
  const { data } = await input.loadSavedQuote()
  assertCurrent()
  if (!data?.quoteNo || !Array.isArray(data.items) ||
      ![data.subtotal, data.discount, data.total, data.installationFee].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("已保存报价资料不完整，请刷新报价页后重试。")
  }
  const items = structuredClone(data.items).map((item, index) => ({ ...item, lineId: `export:${index}` }))
  const snapshot: SavedQuoteExportSnapshot = {
    quoteNo: data.quoteNo,
    status: data.status === "draft" ? "草稿" : data.status || "草稿",
    subtotal: data.subtotal!,
    discountTotal: data.discount!,
    total: data.total!,
    installationFee: data.installationFee!,
    items,
    groups: groupQuoteItems(items, input.groupMode, unique(items.map((item) => item.category)), data.rooms ?? []),
  }
  return { snapshot, assertCurrent }
}

export function groupQuoteItems(
  items: QuoteLineItem[],
  groupMode: QuoteGroupMode,
  productCategories: string[],
  rooms: string[]
) {
  if (groupMode === "none") {
    return [{ name: "报价明细", items }]
  }

  const groupNames = groupMode === "room" ? rooms : productCategories.length ? productCategories : ["未分类"]
  const groups = new Map(groupNames.map((name) => [name, [] as QuoteLineItem[]]))

  for (const item of items) {
    const key = groupMode === "room" ? item.room : item.category
    const target = groups.get(key) ?? []
    target.push(item)
    groups.set(key, target)
  }

  return Array.from(groups.entries()).map(([name, groupItems]) => ({ name, items: groupItems }))
}

export function toProductOption(product: QuoteDatabaseProduct): QuoteProductOption {
  return {
    ...product,
    category: product.category ?? "未分类",
    cost: Number(product.cost ?? 0),
    id: product.id,
    image: product.image || "/placeholder.svg",
    name: product.name,
    price: defaultSellingPrice(product.price, product.cost),
    spec: product.description ?? product.sku,
    unit: product.unit,
  }
}

export function isProductOption(product: QuoteProductOption) {
  return Boolean(product.id && product.name && product.image)
}

export function createLine(product: QuoteProductOption, room: string, quantity = 1): QuoteLineItem {
  return createQuoteLine(product, room, { quantity })
}

export function lineTotal(item: QuoteLineItem) {
  return item.price * item.quantity * (item.discount / 100)
}

export function quoteUnitPrice(item: QuoteLineItem) {
  return item.price > 0 ? money(item.price * (item.discount / 100)) : "待核价"
}

export function productPrice(item: QuoteProductOption) {
  return item.price > 0 ? money(item.price) : "待核价"
}

export function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value)
}

export function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export const UNASSIGNED_FLOOR_PAGE = "未分楼层"

/** 点位来源的房间名形如「楼层 / 房间」；手动添加的行没有楼层前缀。 */
export function floorOfRoom(room: string) {
  const index = room.indexOf(" / ")
  return index > 0 ? room.slice(0, index) : UNASSIGNED_FLOOR_PAGE
}

/** 按出现顺序列出楼层分页；手动行归入「未分楼层」并放在最后。 */
export function quoteFloorPages(items: Array<Pick<QuoteLineItem, "room">>) {
  const floors: string[] = []
  for (const item of items) {
    const floor = floorOfRoom(item.room)
    if (!floors.includes(floor)) floors.push(floor)
  }
  return floors.sort((a, b) => (a === UNASSIGNED_FLOOR_PAGE ? 1 : b === UNASSIGNED_FLOOR_PAGE ? -1 : 0))
}
