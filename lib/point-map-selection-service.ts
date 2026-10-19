import { isDeepStrictEqual } from "node:util"
import type { PoolClient } from "pg"

import { evaluateProductCompatibility, isCountableByPoint, type PointSelectionSnapshot } from "./product-selection"
import { leafForKeyCount } from "./category-default-keys"
import { mapProduct, productColumns, type AdminProduct, type ProductRow } from "./product-admin-service"
import type { PointMapPlan } from "./point-map-plan"

export type SelectionClient = Pick<PoolClient, "query">

export async function loadSelectionProducts(client: SelectionClient, ids: string[]): Promise<AdminProduct[]> {
  const validIds = [...new Set(ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))]
  if (!validIds.length) return []
  const result = await client.query<ProductRow>(
    `select ${productColumns()} from products where id = any($1::uuid[]) and deleted_at is null order by id for share`,
    [validIds],
  )
  return result.rows.map(mapProduct)
}

/**
 * 同步默认产品：每个设备类型取一个启用、可按点位计数的主型号。
 * 若点位带按键数（如开关 1–4 键），优先取该主型号下同按键数的子规格；子规格价格为 0，
 * 价格与成本取主型号上的值。按名称排序保证结果稳定。
 */
/** 品类统一采用的标准主型号（按 SKU）；未配置的品类按名称顺序取第一个。 */
export const PREFERRED_CATEGORY_SKU: Readonly<Record<string, string>> = {
  "wall-switch": "SUMI-H2U", // 苏米 SLC-H2UP 智能开关H2 Ultra
}

/**
 * 同步默认产品解析顺序（按设备类型 + 按键数）：
 * 1. 该键数的指定型号（批量统一换型号时选择的品牌 + 键数）；
 * 2. 该类别全部键数的指定型号；
 * 3. 标准规则：启用的主型号（开关统一采用 H2 Ultra，其余按名称顺序）。
 * 选定主型号后，若有按键数，取其下同键数的子规格；子规格价格为 0，价格与成本取父型号。
 */
export async function loadCategoryDefaultProducts(client: SelectionClient, projectId: string, requests: Array<{ deviceTypeId: string; buttonCount?: number }>): Promise<Map<string, AdminProduct>> {
  const types = [...new Set(requests.map((request) => request.deviceTypeId).filter(Boolean))]
  const defaults = new Map<string, AdminProduct>()
  if (!types.length) return defaults
  const result = await client.query<ProductRow>(
    `select ${productColumns()} from products where device_type_id = any($1::text[]) and status in ('active', 'approved') and deleted_at is null order by (status = 'active') desc, name, id`,
    [types],
  )
  const products = result.rows.map(mapProduct)
  const byId = new Map(products.map((product) => [product.id, product]))
  const chosen = await client.query<{ device_type_id: string; button_count: number; product_id: string }>(
    `select device_type_id, button_count, product_id::text from project_category_default_products where project_id = $1::uuid and device_type_id = any($2::text[])`,
    [projectId, types],
  )
  const overrides = new Map(chosen.rows.map((row) => [`${row.device_type_id}:${row.button_count}`, row.product_id]))
  const standardMain = new Map<string, AdminProduct>()
  for (const product of products) {
    if (!product.deviceTypeId || product.parentProductId || !isCountableByPoint(product)) continue
    const preferred = PREFERRED_CATEGORY_SKU[product.deviceTypeId] === product.sku
    if (preferred || !standardMain.has(product.deviceTypeId)) standardMain.set(product.deviceTypeId, product)
  }
  // 子规格价格为 0，价格与成本取父型号。
  const withParentPricing = (product: AdminProduct): AdminProduct => {
    const parent = product.parentProductId ? byId.get(product.parentProductId) : undefined
    if (!parent) return product
    return { ...product, price: parent.price, cost: parent.cost, pricingStatus: parent.pricingStatus, pricingEvidence: parent.pricingEvidence }
  }
  const resolve = (deviceTypeId: string, keyCount: number): AdminProduct | undefined => {
    if (keyCount) {
      const specificId = overrides.get(`${deviceTypeId}:${keyCount}`)
      const specific = specificId ? byId.get(specificId) : undefined
      if (specific) return withParentPricing(leafForKeyCount(specific, keyCount, products) ?? specific)
    }
    const allId = overrides.get(`${deviceTypeId}:0`)
    const main = (allId ? byId.get(allId) : undefined) ?? standardMain.get(deviceTypeId)
    if (!main) return undefined
    return withParentPricing((keyCount ? leafForKeyCount(main, keyCount, products) : undefined) ?? main)
  }
  for (const request of requests) {
    if (!request.deviceTypeId) continue
    const plain = resolve(request.deviceTypeId, 0)
    if (plain) defaults.set(request.deviceTypeId, plain)
    if (request.buttonCount) {
      const counted = resolve(request.deviceTypeId, request.buttonCount)
      if (counted) defaults.set(`${request.deviceTypeId}:${request.buttonCount}`, counted)
    }
  }
  return defaults
}

/** Client supplied snapshots are never accepted as proof of compatibility. */
export async function hydratePlanSelections(client: SelectionClient, plan: PointMapPlan, actorId: string, trustedPreviousPlan?: PointMapPlan): Promise<PointMapPlan> {
  const products = await loadSelectionProducts(client, plan.points.flatMap((point) => [point.productId, ...(point.materials ?? []).map((material) => material.productId)]))
  const byId = new Map(products.map((product) => [product.id, product]))
  const trustedPoints = new Map((trustedPreviousPlan?.points ?? []).map((point) => [point.id, point]))
  return {
    ...plan,
    points: plan.points.map((point) => {
      const trustedPoint = trustedPoints.get(point.id)
      const materials = point.materials?.map((material) => {
        const stored = trustedPoint?.materials?.find((item) => item.id === material.id)?.selection
        const previous = stored && isDeepStrictEqual(material.selection, stored) ? stored : undefined
        const baseMaterial = { ...material }
        delete baseMaterial.selection
        const trustedMaterial = previous ? { ...baseMaterial, selection: previous } : baseMaterial
        if (material.included || !material.productId) return trustedMaterial
        const product = byId.get(material.productId)
        if (!product || evaluateProductCompatibility({ deviceTypeId: product.deviceTypeId }, product).status !== "compatible") return trustedMaterial
        if (previous && (previous.productId !== product.id || previous.mappingRevision !== product.mappingRevision)) return trustedMaterial
        return { ...baseMaterial, selection: createSelectionSnapshot(product, actorId) }
      })
      const { selection: submitted, ...base } = point
      const previous = trustedPoint?.selection && isDeepStrictEqual(submitted, trustedPoint.selection) ? trustedPoint.selection : undefined
      const unverified = { ...base, ...(materials ? { materials } : {}) }
      if (!point.productId || point.usage !== "selected") return unverified
      const product = byId.get(point.productId)
      if (!product || evaluateProductCompatibility(point, product).status !== "compatible") return previous ? { ...unverified, selection: previous } : unverified
      // Changing a previously selected SKU's specification requires an explicit reselect.
      if (previous && (previous.productId !== product.id || previous.mappingRevision !== product.mappingRevision)) return { ...unverified, selection: previous }
      const selection = createSelectionSnapshot(product, actorId)
      return { ...unverified, selection }
    }),
  }
}

function createSelectionSnapshot(product: AdminProduct, actorId: string): PointSelectionSnapshot {
  return {
    productId: product.id, mappingRevision: product.mappingRevision ?? 1,
    deviceTypeId: product.deviceTypeId!, sku: product.sku, name: product.name,
    manufacturerModel: product.manufacturerModel ?? null, specs: { ...product.specs },
    protocols: [...(product.protocols ?? [])], capabilities: [...(product.capabilities ?? [])],
    unit: product.unit, verifiedAt: new Date().toISOString(), verifiedBy: actorId,
  }
}
