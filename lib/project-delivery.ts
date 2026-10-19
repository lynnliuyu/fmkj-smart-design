import type { PointMapPlan } from "./point-map-plan"
import type { SavedQuoteItem } from "./quote-authoring"
import type { ProductVisualAsset } from "./product-visual-assets"

export type ProjectDeliveryProject = {
  id: string
  name: string
  code: string
  customer: string
  address: string
}

export type ProjectDeliveryQuoteItem = SavedQuoteItem & {
  lineId: string
  imageSource?: string | null
  finalUnitPrice: number
  subtotalAmount: number
  finalAmount: number
}

export type ProjectDeliveryQuote = {
  id: string
  quoteNo: string
  title: string
  status: string
  subtotal: number
  discount: number
  total: number
  installationFee: number
  rooms: string[]
  items: ProjectDeliveryQuoteItem[]
}

export type ProjectDeliveryProduct = {
  id: string
  name: string
  image: string | null
  imageSource: string | null
  visualAsset: ProductVisualAsset | null
}

export type ProjectDeliveryChanges = {
  comparedToVersion: number | null
  floorIds: string[]
  pointsAdded: number
  pointsRemoved: number
  pointsChanged: number
  productsChanged: string[]
  photosChanged: string[]
  scenesChanged: boolean
  quoteChanged: boolean
  productOverrides: number
  messages: string[]
}

/** Data needed to reproduce a handover. No later catalogue reads are necessary. */
export type ProjectDeliverySnapshot = {
  id: string | null
  version: number
  createdAt: string
  project: ProjectDeliveryProject
  plan: PointMapPlan
  pointMapRevision: number
  quote: ProjectDeliveryQuote | null
  products: ProjectDeliveryProduct[]
  changes: ProjectDeliveryChanges
  fingerprint: string
  reused?: boolean
}

export type ProjectDeliverySummary = Pick<ProjectDeliverySnapshot, "id" | "version" | "createdAt" | "pointMapRevision" | "fingerprint" | "changes"> & {
  quoteNo: string | null
  total: number | null
}

/** Prefer the stored final unit price; never round a discount percentage first. */
export function deliveryLineUnitPrice(item: { price: number; discount?: number; finalUnitPrice?: number }): number {
  return typeof item.finalUnitPrice === "number" && Number.isFinite(item.finalUnitPrice)
    ? item.finalUnitPrice
    : item.price * ((item.discount ?? 100) / 100)
}

export function deliveryLineTotal(item: { price: number; quantity: number; discount?: number; finalUnitPrice?: number; finalAmount?: number }): number {
  return typeof item.finalAmount === "number" && Number.isFinite(item.finalAmount)
    ? item.finalAmount
    : deliveryLineUnitPrice(item) * item.quantity
}

export function summarizeDelivery(snapshot: ProjectDeliverySnapshot): ProjectDeliverySummary {
  return {
    id: snapshot.id, version: snapshot.version, createdAt: snapshot.createdAt,
    pointMapRevision: snapshot.pointMapRevision, fingerprint: snapshot.fingerprint, changes: snapshot.changes,
    quoteNo: snapshot.quote?.quoteNo ?? null, total: snapshot.quote?.total ?? null,
  }
}

export function deliveryChanges(current: ProjectDeliverySnapshot, previous: ProjectDeliverySnapshot | null, productOverrides = 0): ProjectDeliveryChanges {
  const priorPoints = new Map((previous?.plan.points ?? []).map((point) => [point.id, point]))
  const currentPoints = new Map(current.plan.points.map((point) => [point.id, point]))
  const floors = new Set<string>()
  let added = 0, removed = 0, changed = 0
  for (const point of current.plan.points) {
    const old = priorPoints.get(point.id)
    if (!old) { added++; if (point.floorId) floors.add(point.floorId) }
    else if (stableDeliveryJson(old) !== stableDeliveryJson(point)) {
      changed++
      if (point.floorId) floors.add(point.floorId)
      if (old.floorId) floors.add(old.floorId)
    }
  }
  for (const point of previous?.plan.points ?? []) if (!currentPoints.has(point.id)) {
    removed++; if (point.floorId) floors.add(point.floorId)
  }
  const priorFloors = new Map((previous?.plan.floors ?? []).map((floor) => [floor.id, floor]))
  for (const floor of current.plan.floors ?? []) if (stableDeliveryJson(priorFloors.get(floor.id)) !== stableDeliveryJson(floor)) floors.add(floor.id)
  const oldProducts = new Map((previous?.products ?? []).map((product) => [product.id, product]))
  const productsChanged = current.products.filter((product) => !oldProducts.has(product.id)).map((product) => product.id)
  const photosChanged = current.products.filter((product) => {
    const old = oldProducts.get(product.id)
    return old && (old.image !== product.image || stableDeliveryJson(old.visualAsset) !== stableDeliveryJson(product.visualAsset))
  }).map((product) => product.id)
  for (const point of current.plan.points) if (photosChanged.includes(point.productId) && point.floorId) floors.add(point.floorId)
  for (const item of current.quote?.items ?? []) if (photosChanged.includes(item.id)) for (const id of item.pointIds ?? []) {
    const floorId = currentPoints.get(id)?.floorId
    if (floorId) floors.add(floorId)
  }
  const scenesChanged = stableDeliveryJson(current.plan.scenes) !== stableDeliveryJson(previous?.plan.scenes)
  const quoteMoney = (quote: ProjectDeliveryQuote | null | undefined) => quote && ({
    id: quote.id, quoteNo: quote.quoteNo, subtotal: quote.subtotal, discount: quote.discount,
    total: quote.total, installationFee: quote.installationFee,
    items: quote.items.map((item) => ({ id: item.id, room: item.room, price: item.price, quantity: item.quantity, finalUnitPrice: item.finalUnitPrice, finalAmount: item.finalAmount, pointIds: item.pointIds })),
  })
  const quoteChanged = stableDeliveryJson(quoteMoney(current.quote)) !== stableDeliveryJson(quoteMoney(previous?.quote))
  const messages = !previous ? ["首次生成完整交付版本。"] : [
    ...(added || removed || changed ? [`点位新增 ${added}、移除 ${removed}、调整 ${changed}。`] : []),
    ...(photosChanged.length ? [`更新 ${photosChanged.length} 件商品的展示图片。`] : []),
    ...(productsChanged.length ? [`新增 ${productsChanged.length} 件引用商品。`] : []),
    ...(scenesChanged ? ["场景方案已更新。"] : []),
    ...(quoteChanged ? ["报价内容已更新，金额使用已保存报价。"] : []),
    ...(floors.size && !added && !removed && !changed && !photosChanged.length ? ["楼层展示底图已更新。"] : []),
  ]
  if (productOverrides) messages.push(`${productOverrides} 个点位采用报价中明确关联的商品。`)
  if (!messages.length) messages.push("内容与上一交付版本一致。")
  return { comparedToVersion: previous?.version ?? null, floorIds: [...floors], pointsAdded: added, pointsRemoved: removed, pointsChanged: changed, productsChanged, photosChanged, scenesChanged, quoteChanged, productOverrides, messages }
}

/** Stable key order makes equal content reusable across JSON/database round trips. */
export function stableDeliveryJson(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableDeliveryJson).join(",")}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableDeliveryJson(object[key])}`).join(",")}}`
}
