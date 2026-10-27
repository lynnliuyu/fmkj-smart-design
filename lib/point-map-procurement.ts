import { canExpandProductToPoints, deviceIntentForIcon, evaluateProductCompatibility, isCountableByPoint, type SelectionProduct } from "./product-selection"
import { expandPointMaterials } from "./point-materials"
import type { PointMapNode, PointMapPlan } from "./point-map-plan"
import type { PointMapQuoteSnapshot, QuoteDraftItem, QuoteDraftProduct } from "./quote-draft"
import { catalogQuotationVerification, quoteVerification, type QuotationVerification } from "./quote-verification"

/** 同步报价时未指定产品的点位，默认采用的设备类型：未填设备类型时按图标推断，窗帘图标取窗帘电机。 */
const DEFAULT_DEVICE_TYPE_BY_ICON: Record<string, string> = { curtain: "curtain-motor" }
export function defaultDeviceTypeForPoint(point: Pick<PointMapNode, "deviceTypeId" | "iconId">): string | undefined {
  return point.deviceTypeId || DEFAULT_DEVICE_TYPE_BY_ICON[point.iconId] || deviceIntentForIcon(point.iconId)?.deviceTypeId || undefined
}

/** 点位的按键数：优先取点位要求，否则由开关图标 switch-1…switch-4 推断。 */
export function defaultButtonCountForPoint(point: Pick<PointMapNode, "requirements" | "iconId">): number | undefined {
  const required = point.requirements?.button_count
  if (typeof required === "number" && Number.isInteger(required)) return required
  const icon = /^switch-([1-4])$/.exec(point.iconId)
  return icon ? Number(icon[1]) : undefined
}

/** 默认产品的查找键：开关按按键数区分子规格，其他品类只按设备类型。 */
export function categoryDefaultKey(point: Pick<PointMapNode, "requirements" | "iconId">, deviceTypeId: string): string {
  const buttons = deviceTypeId === "wall-switch" ? defaultButtonCountForPoint(point) : undefined
  return buttons ? `${deviceTypeId}:${buttons}` : deviceTypeId
}

export type ProcurementDiagnostic = { pointId: string; code: string; reasons: string[] }
export type ProcurementProduct = QuoteDraftProduct & SelectionProduct
export type PointMapProcurementPreview = {
  data: PointMapQuoteSnapshot
  diagnostics: ProcurementDiagnostic[]
  blocked: boolean
  included: number
  excluded: number
  unverified: ProcurementDiagnostic[]
  procurementReady: boolean
}

/** 普通成员收到的报价预览保留售价和数量，进货成本只按财务权限提供。 */
export type PointMapProcurementPreviewResponse = Omit<PointMapProcurementPreview, "data"> & {
  data: Omit<PointMapQuoteSnapshot, "items"> & {
    items: Array<Omit<QuoteDraftItem, "cost"> & { cost?: number }>
  }
}

/** Missing selected items block the whole replacement, preserving the existing quote. */
export function buildProcurementPreview(
  plan: PointMapPlan,
  revision: number,
  products: ProcurementProduct[],
  projectName: string,
  categoryDefaults: ReadonlyMap<string, ProcurementProduct> = new Map(),
): PointMapProcurementPreview {
  const diagnostics: ProcurementDiagnostic[] = []
  const unverified: ProcurementDiagnostic[] = []
  const byId = new Map(products.map((product) => [product.id, product]))
  const groups = new Map<string, QuoteDraftItem>()
  const floorById = new Map((plan.floors ?? []).map((floor) => [floor.id, floor.name]))
  const physicalMaterials = new Map<string, { productId: string; quantity: number; unit: string }>()
  for (const point of plan.points.filter((point) => point.usage === "selected")) {
    const product = byId.get(point.productId)
    if (product) physicalMaterials.set(point.id, { productId: product.id, quantity: 1, unit: product.unit })
  }
  let included = 0
  let excluded = 0
  for (const point of plan.points) {
    // 未填设备类型的点位按图标推断；未指定产品的点位套用设备类型默认产品（预留点位除外）。
    const deviceTypeId = defaultDeviceTypeForPoint(point)
    const fallback = !point.productId && point.usage !== "reserve" && deviceTypeId
      ? categoryDefaults.get(categoryDefaultKey(point, deviceTypeId)) ?? categoryDefaults.get(deviceTypeId)
      : undefined
    if (point.usage !== "selected" && !fallback) { excluded++; continue }
    const reasons: string[] = []
    if (!fallback && (!point.placed || point.status !== "confirmed")) reasons.push("点位尚未定位或完成设计确认")
    const product = fallback ?? byId.get(point.productId)
    if (!product) reasons.push(point.productId ? "关联产品不存在或不可用" : "尚未选择具体产品")
    else if (fallback) {
      if (product.deviceTypeId !== deviceTypeId) reasons.push("默认产品的设备类型与点位不符")
      if (!Number.isFinite(product.price) || product.price < 0 || !Number.isFinite(product.cost) || product.cost < 0) reasons.push("产品价格或成本无效")
      // 默认产品按点位自身的设备类型计数，不要求产品规格能推导出图标。
      if (!isCountableByPoint(product)) reasons.push("材料或服务不能按实体点位直接计数")
    }
    else {
      reasons.push(...evaluateProductCompatibility(point, product).reasons)
      if (!point.selection || point.selection.productId !== product.id || point.selection.mappingRevision !== product.mappingRevision) reasons.push("产品选型尚未保存核验，或规格已经更新")
      if (product.pricingStatus !== "verified" || !product.pricingEvidence?.trim()) reasons.push("价格尚未核验")
      if (!Number.isFinite(product.price) || product.price < 0 || !Number.isFinite(product.cost) || product.cost < 0) reasons.push("产品价格或成本无效")
      if (!canExpandProductToPoints(product)) reasons.push("材料或服务不能按实体点位直接计数")
    }
    const materials = expandPointMaterials(
      fallback ? { ...point, deviceTypeId, productId: fallback.id } : point,
      fallback ? [...products, fallback] : products,
    )
    // Default customer quotations may omit unknown materials with an explicit scope note.
    // Missing/stale selected SKUs, invalid data and physical conflicts still block replacement.
    const materialQuoteNotes: string[] = []
    for (const diagnostic of materials.diagnostics.filter((diagnostic) => diagnostic.blocking)) {
      const missingInformation = ["curtain-materials-incomplete", "quantity-unknown", "unit-unknown"].includes(diagnostic.code) ||
        diagnostic.code === "product-unknown" && !point.materials?.find((material) => material.id === diagnostic.materialId)?.productId
      if (fallback && missingInformation) materialQuoteNotes.push(`配套未计入本次报价：${diagnostic.message}，待核对后补报`)
      else reasons.push(diagnostic.message)
    }
    if (reasons.length) {
      diagnostics.push({ pointId: point.id, code: point.code ?? point.id, reasons: [...new Set(reasons)] })
      continue
    }
    const quotationVerification: QuotationVerification = fallback ? {
      status: "unverified", source: "default",
      reasons: [...new Set(["默认型号尚未逐点确认", ...catalogQuotationVerification(product).reasons,
        ...(!point.placed || point.status !== "confirmed" ? ["布局尚未完成定位或设计确认"] : []),
        ...evaluateProductCompatibility(point, product!).reasons, ...materialQuoteNotes])],
    } : { status: "verified", source: "selection", reasons: [] }
    if (quotationVerification.status === "unverified") unverified.push({ pointId: point.id, code: point.code ?? point.id, reasons: quotationVerification.reasons })
    const snapshot = { ...(product!.productSnapshot ?? {}), quotationVerification }
    const floor = point.floorId ? floorById.get(point.floorId) : ""
    // 房间名里可能已经带楼层前缀（存量数据），别拼成「全屋 / 全屋 / 弱电箱」。
    const room = floor && !point.room.startsWith(`${floor} / `) ? `${floor} / ${point.room}` : point.room
    const key = JSON.stringify([product!.id, room])
    const existing = groups.get(key)
    if (existing) {
      existing.quantity++; existing.pointIds!.push(point.id)
      const previous = quoteVerification(existing)
      existing.productSnapshot = { ...existing.productSnapshot, quotationVerification: {
        status: previous.status === "unverified" || quotationVerification.status === "unverified" ? "unverified" : "verified",
        source: previous.source === "default" || quotationVerification.source === "default" ? "default" : "selection",
        reasons: [...new Set([...previous.reasons, ...quotationVerification.reasons])],
      } }
    }
    else groups.set(key, { ...product!, productSnapshot: snapshot, project: projectName, projectId: plan.projectId, room, quantity: 1, pointMapProjectId: plan.projectId, pointMapRevision: revision, pointIds: [point.id] })
    included++
    for (const material of materials.lineItems) {
      const materialProduct = byId.get(material.productId)!
      const physicalId = point.materials?.find((entry) => entry.id === material.materialId)?.physicalDeviceId
      if (physicalId) {
        const previous = physicalMaterials.get(physicalId)
        if (previous) {
          if (previous.productId !== material.productId || previous.unit !== material.unit || previous.quantity !== material.quantity) diagnostics.push({ pointId: point.id, code: point.code ?? point.id, reasons: ["同一实体的配套型号、数量或单位存在冲突"] })
          continue
        }
        physicalMaterials.set(physicalId, { productId: material.productId, quantity: material.quantity, unit: material.unit })
      }
      const materialKey = JSON.stringify([material.productId, room])
      const materialExisting = groups.get(materialKey)
      if (materialExisting) {
        materialExisting.quantity = Math.round((materialExisting.quantity + material.quantity) * 1000000) / 1000000
        if (!materialExisting.pointIds!.includes(point.id)) materialExisting.pointIds!.push(point.id)
      } else groups.set(materialKey, { ...materialProduct, project: projectName, projectId: plan.projectId, room, quantity: material.quantity, pointMapProjectId: plan.projectId, pointMapRevision: revision, pointIds: [point.id] })
    }
  }
  return {
    data: {
      projectId: plan.projectId,
      revision,
      items: [...groups.values()],
      // 房间从点位方案本身来：楼层 + 点位的房间，去重。
      rooms: Array.from(new Set(plan.points.map((point) => {
        const floor = plan.floors?.find((entry) => entry.id === point.floorId)?.name
        if (!point.room) return ""
        // 房间名本身可能带楼层前缀，别拼成「全屋 / 全屋 / 弱电箱」。
        return floor && !point.room.startsWith(`${floor} / `) ? `${floor} / ${point.room}` : point.room
      }).filter(Boolean))),
    },
    diagnostics, blocked: diagnostics.length > 0, included, excluded, unverified,
    procurementReady: diagnostics.length === 0 && unverified.length === 0,
  }
}
