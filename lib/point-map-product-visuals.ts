import { normalizeDesignPlan } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"
import type { PointMapRenderProduct } from "./point-map-render"
import { usableProductImage } from "./product-image-source"
import type { ProductVisualAsset } from "./product-visual-assets"

/** Both the saved quote API and the editable quote use the product ID as `id`. */
export type PointMapVisualQuoteItem = {
  id?: string | null
  productId?: string | null
  image?: string | null
  pointIds?: readonly string[] | null
  pointMapProjectId?: string | null
  productSnapshot?: Record<string, unknown>
}

export type PointMapProductVisuals = {
  products: PointMapRenderProduct[]
  productIdByPointId: Map<string, string>
}

/**
 * Resolve the current quote's selection without writing it back to the design.
 * Kept shared by PNG and PDF exports so changing a quote item changes both images.
 */
export function buildPointMapProductVisuals(
  input: PointMapPlan,
  floorId: string,
  quoteItems: readonly PointMapVisualQuoteItem[],
  catalog: readonly PointMapRenderProduct[],
): PointMapProductVisuals {
  const plan = normalizeDesignPlan(input)
  if (!plan.floors?.some((floor) => floor.id === floorId)) throw new Error("未找到需要出图的楼层。")
  const points = plan.points.filter((point) => point.floorId === floorId && point.placed)
  const pointById = new Map(points.map((point) => [point.id, point]))
  const quoteProductByPointId = new Map<string, string>()
  const quoteImageByProductId = new Map<string, string>()
  const quoteVisualByProductId = new Map<string, ProductVisualAsset>()

  for (const item of quoteItems) {
    const sourceProject = item.pointMapProjectId?.trim()
    if (sourceProject && sourceProject !== plan.projectId) continue
    const productId = item.productId?.trim() || item.id?.trim()
    if (!productId) continue
    let usedOnFloor = false
    for (const pointId of item.pointIds ?? []) {
      const point = pointById.get(pointId)
      if (!point) continue
      // Procurement rows for tracks/accessories/services reuse the installation
      // point's IDs. Only explicit material links distinguish them from its device.
      if (point.materials?.some((material) => material.productId === productId)) continue
      const existingProductId = quoteProductByPointId.get(pointId)
      if (existingProductId && existingProductId !== productId) {
        throw new Error(`点位 ${point.code || point.id} 在当前报价中关联了多个商品（${existingProductId}、${productId}），请先整理商品对应关系再导出。`)
      }
      quoteProductByPointId.set(pointId, productId)
      usedOnFloor = true
    }
    if (usedOnFloor && !quoteImageByProductId.has(productId)) {
      const image = usableProductImage(item.image)
      if (image) quoteImageByProductId.set(productId, image)
      const visual = item.productSnapshot?.visualAsset as ProductVisualAsset | null | undefined
      if (image && visual && usableProductImage(visual.image) === image) quoteVisualByProductId.set(productId, visual)
    }
  }

  const productIdByPointId = new Map<string, string>()
  for (const point of points) {
    const productId = quoteProductByPointId.get(point.id) || point.productId?.trim()
    if (productId) productIdByPointId.set(point.id, productId)
  }
  const productIds = new Set(productIdByPointId.values())
  const catalogImageByProductId = new Map<string, string>()
  const catalogById = new Map(catalog.map((product) => [product.id, product]))
  for (const product of catalog) {
    // Do not read images belonging to another floor or unused catalog products.
    if (!productIds.has(product.id) || catalogImageByProductId.has(product.id)) continue
    const image = usableProductImage(product.image)
    if (image) catalogImageByProductId.set(product.id, image)
  }
  return {
    productIdByPointId,
    products: [...productIds].map((id) => {
      const quoted = quoteImageByProductId.get(id)
      const original = catalogById.get(id)
      const catalogImage = catalogImageByProductId.get(id)
      const currentVisual = original?.visualAsset && usableProductImage(original.visualAsset.image) ? original.visualAsset : undefined
      const visualAsset = quoteVisualByProductId.get(id) ?? ((!quoted || quoted === currentVisual?.image) ? currentVisual : undefined)
      return { id, image: quoted || usableProductImage(visualAsset?.image) || catalogImage || null, ...(visualAsset ? { visualAsset } : {}) }
    }),
  }
}

