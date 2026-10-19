import { findDeviceType, type DeviceSpecs } from "./device-types"
import { pointIconDefinitions } from "./point-icons"
import { isStandardProductCategory, STANDARD_PRODUCT_CATEGORIES } from "./product-categories"
import { iconForSelectionProduct } from "./product-selection"

export type PointClassifiableProduct = {
  category?: string | null
  deviceTypeId?: string | null
  specs?: DeviceSpecs
}

export type ProductPointFilter = { category: string; iconId: string }
export const ALL_POINT_PRODUCTS: ProductPointFilter = { category: "all", iconId: "all" }
export const POINT_MATERIAL_CATEGORY = "配套用料"
export const UNKNOWN_POINT_CATEGORY = "待整理"
export const UNKNOWN_POINT_ICON = "unassigned"
export const productPointCategories = [...STANDARD_PRODUCT_CATEGORIES, POINT_MATERIAL_CATEGORY, UNKNOWN_POINT_CATEGORY]

/** Navigation only: a display classification never grants selection or pricing approval. */
export function classifyProductForPointMap(product: PointClassifiableProduct) {
  const type = findDeviceType(product.deviceTypeId)
  const category = type?.id === "accessory" || type?.id === "installation-service"
    ? POINT_MATERIAL_CATEGORY
    : type?.category ?? (isStandardProductCategory(product.category) ? product.category : UNKNOWN_POINT_CATEGORY)
  const iconId = type ? iconForSelectionProduct(product) : undefined
  const icon = pointIconDefinitions.find((item) => item.id === iconId)
  return { category, iconId: icon?.id ?? UNKNOWN_POINT_ICON, icon, label: icon?.name ?? (category === POINT_MATERIAL_CATEGORY ? POINT_MATERIAL_CATEGORY : `${category} · 图标待定`) }
}

export function matchesProductPointFilter(product: PointClassifiableProduct, filter: ProductPointFilter) {
  const classification = classifyProductForPointMap(product)
  return (filter.category === "all" || filter.category === classification.category) &&
    (filter.iconId === "all" || filter.iconId === classification.iconId)
}
