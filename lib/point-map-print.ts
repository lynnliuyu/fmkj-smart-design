import { normalizeDesignPlan } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"
import { buildPointMapProductVisuals, type PointMapVisualQuoteItem } from "./point-map-product-visuals"
import { getPointMapRenderGeometry, renderPointMapFloor, type PointMapRenderGeometry, type PointMapRenderProduct } from "./point-map-render"
import { defaultPointMapFloorRenderCache, pointMapFloorRenderKey, type CachedPointMapFloor, type PointMapFloorRenderCache } from "./point-map-render-cache"

export type PointMapPrintFloor = { id: string; name: string; src: string; markerGeometry?: PointMapRenderGeometry; cacheKey?: string; reused?: boolean }
const ownedUrls = new WeakMap<PointMapPrintFloor, string>()

/** Call after replacing printed floors or closing their owning view. */
export function releasePointMapPrintFloors(floors: readonly PointMapPrintFloor[]) {
  for (const floor of floors) {
    const url = ownedUrls.get(floor)
    if (url) { URL.revokeObjectURL(url); ownedUrls.delete(floor) }
  }
}

/** Generate every printed page from one plan and one quote, never from bundled sample PNGs. */
export async function renderPointMapPrintFloors(
  input: PointMapPlan,
  quoteItems: readonly PointMapVisualQuoteItem[],
  products: readonly PointMapRenderProduct[],
  options: { cacheNamespace?: string; cache?: PointMapFloorRenderCache; floorIds?: readonly string[] } = {},
): Promise<PointMapPrintFloor[]> {
  const plan = normalizeDesignPlan(input)
  const images: PointMapPrintFloor[] = []
  const cache = options.cache ?? defaultPointMapFloorRenderCache()
  try {
  if (options.floorIds?.some((id) => !plan.floors?.some((floor) => floor.id === id))) throw new Error("未找到需要出图的楼层。")
  // Release each canvas before moving to the next large CAD base.
  for (const floor of plan.floors ?? []) {
    if (options.floorIds && !options.floorIds.includes(floor.id)) continue
    if (!floor.floorplanDataUrl && !plan.points.some((point) => point.floorId === floor.id && point.placed)) continue
    if (!floor.floorplanDataUrl) throw new Error(`${floor.name} 尚未上传底图，请补充后导出。`)
    const visual = buildPointMapProductVisuals(plan, floor.id, quoteItems, products)
    const cacheKey = await pointMapFloorRenderKey(plan, floor.id, visual.products, visual.productIdByPointId, options.cacheNamespace)
    let result: CachedPointMapFloor | undefined
    try { result = await cache.get(cacheKey) } catch { /* A disabled local cache must not stop an export. */ }
    const reused = Boolean(result)
    if (!result) {
    const canvas = await renderPointMapFloor(plan, floor.id, {
      ...visual,
      background: "presentation",
      pointsOnly: true,
      productCircles: true,
      strictProductImages: true,
    })
    try {
      result = { markerGeometry: getPointMapRenderGeometry(canvas), ...(typeof canvas.toBlob === "function"
        ? { blob: await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`${floor.name} 的 PNG 生成失败，请重试。`)), "image/png")) }
        : { dataUrl: canvas.toDataURL("image/png") }) }
      try { await cache.put(cacheKey, result) } catch { /* Export still succeeds when local storage is full. */ }
    } finally {
    canvas.width = 0
    canvas.height = 0
    }
    }
    const src = result.blob ? URL.createObjectURL(result.blob) : result.dataUrl!
    const output = { id: floor.id, name: floor.name, src, markerGeometry: result.markerGeometry, cacheKey, reused }
    if (result.blob) ownedUrls.set(output, src)
    images.push(output)
  }
  return images
  } catch (error) { releasePointMapPrintFloors(images); throw error }
}

/** Decode the committed print DOM before opening the browser's PDF dialog. */
export async function waitForPrintImages(root: HTMLElement) {
  await Promise.all(Array.from(root.querySelectorAll("img")).map((image) => image.decode()))
  await document.fonts?.ready
}
