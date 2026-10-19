import { evaluateProductCompatibility, normalizePointSelectionSnapshot, type PointSelectionSnapshot, type SelectionProduct } from "./product-selection"

export type PointMaterial = {
  id: string
  productId: string
  role: "accessory" | "track" | "service"
  quantity: number | null
  unit: string
  required: boolean
  included: boolean
  physicalDeviceId?: string
  selection?: PointSelectionSnapshot
}

export type PointMaterialLineItem = {
  pointId: string
  materialId: string
  productId: string
  role: PointMaterial["role"]
  quantity: number
  unit: string
  product: SelectionProduct
}

export type PointMaterialDiagnostic = {
  pointId: string
  materialId: string
  code: string
  message: string
  blocking: boolean
}

type MaterialPoint = { id: string; productId?: string; deviceTypeId?: string | null; materials?: PointMaterial[] }

/** Null quantity is unknown. Repeated imports cannot duplicate a stable material identity. */
export function normalizePointMaterials(value: unknown): PointMaterial[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 100) throw new Error("配套用料必须为不超过 100 项的清单")
  const items = new Map<string, PointMaterial>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配套用料格式无效")
    const entry = raw as Record<string, unknown>
    const allowed = new Set(["id", "productId", "role", "quantity", "unit", "required", "included", "physicalDeviceId", "selection"])
    if (Object.keys(entry).some((key) => !allowed.has(key))) throw new Error("配套用料含不支持的字段")
    const text = (key: string, required = false) => {
      const value = entry[key]
      if (value == null && !required) return ""
      if (typeof value !== "string" || value.length > 200 || (required && !value.trim())) throw new Error(`配套用料 ${key} 无效`)
      return value.trim()
    }
    if (!["accessory", "track", "service"].includes(String(entry.role))) throw new Error("配套用料角色无效")
    if (entry.quantity != null && (typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity <= 0 || entry.quantity > 1_000_000)) throw new Error("用料数量必须为正数；未知数量请留空")
    if (typeof entry.required !== "boolean" || typeof entry.included !== "boolean") throw new Error("必配及套装已含标记必须为是/否")
    const item: PointMaterial = {
      id: text("id", true), productId: text("productId"), role: entry.role as PointMaterial["role"],
      quantity: entry.quantity == null ? null : entry.quantity as number, unit: text("unit"),
      required: entry.required, included: entry.included,
      ...(entry.physicalDeviceId ? { physicalDeviceId: text("physicalDeviceId", true) } : {}),
      ...(entry.selection != null ? { selection: normalizePointSelectionSnapshot(entry.selection) } : {}),
    }
    const prior = items.get(item.id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) throw new Error(`配套用料 ${item.id} 重复且内容冲突`)
    items.set(item.id, item)
  }
  return [...items.values()]
}

/** Recomputes a bill of materials; it never appends to a previous expansion or rounds metres. */
export function expandPointMaterials(point: MaterialPoint, products: readonly SelectionProduct[]) {
  const lineItems: PointMaterialLineItem[] = []
  const diagnostics: PointMaterialDiagnostic[] = []
  const physicalDevices = new Map<string, PointMaterialLineItem | null>()
  const productById = new Map(products.map((product) => [product.id, product]))
  const main = point.productId ? productById.get(point.productId) : undefined
  let materials: PointMaterial[]
  const issue = (materialId: string, code: string, message: string, blocking = true) => diagnostics.push({ pointId: point.id, materialId, code, message, blocking })
  try { materials = normalizePointMaterials(point.materials) }
  catch (error) {
    issue("", "invalid-materials", error instanceof Error ? error.message : "配套用料格式无效")
    return { lineItems, diagnostics }
  }
  if (point.deviceTypeId === "curtain-motor" && !materials.some((material) => material.role === "track")) {
    issue("", "curtain-materials-incomplete", "窗帘电机的轨道及配套材料尚未展开")
  }
  for (const material of materials) {
    const selected = productById.get(material.productId)
    const committed = material.required || Boolean(material.productId)
    if (material.quantity == null) issue(material.id, "quantity-unknown", material.role === "track" ? "轨道长度待测" : "用料数量待确认", committed)
    if (!material.unit) issue(material.id, "unit-unknown", "用料计量单位待确认", committed)
    if (material.included) {
      if (material.role === "track" && (main?.deviceTypeId !== "curtain-kit" || main.specs?.track_included !== true)) issue(material.id, "included-conflict", "尚无已含轨道的套装依据，请核对供货范围")
      // Already included components may have no separate saleable SKU.
      continue
    }
    if (!material.productId || !selected) {
      issue(material.id, "product-unknown", material.productId ? "配套型号已不可用，请重新选型" : "配套型号待选择", committed)
      continue
    }
    if (material.role === "track" && main?.deviceTypeId === "curtain-kit" && main.specs?.track_included === true) {
      issue(material.id, "included-double-count", "主套装已包含轨道，请标记为已含，避免重复采购")
      continue
    }
    if (!material.selection) {
      issue(material.id, "selection-unsaved", "配套选型待保存核验", committed)
      continue
    }
    if (material.selection.productId !== selected.id || material.selection.mappingRevision !== (selected.mappingRevision ?? 1)) {
      issue(material.id, "selection-stale", "配套 SKU 已变化，请核对后重新选择", committed)
      continue
    }
    const compatibility = evaluateProductCompatibility({ deviceTypeId: selected.deviceTypeId }, selected)
    if (compatibility.status !== "compatible") {
      issue(material.id, "product-unverified", compatibility.reasons.join("；"), committed)
      continue
    }
    if (selected.pricingStatus !== "verified" || !selected.pricingEvidence?.trim()) {
      issue(material.id, "pricing-unverified", "配套 SKU 价格尚未核验", committed)
      continue
    }
    if (material.unit !== selected.unit.trim()) {
      issue(material.id, "unit-conflict", `用料单位与 SKU 不一致：清单 ${material.unit || "未知"}，产品 ${selected.unit}`, committed)
      continue
    }
    if (material.role === "track" && ["curtain-motor", "curtain-kit"].includes(point.deviceTypeId ?? "")) {
      if (selected.deviceTypeId !== "curtain-track") {
        issue(material.id, "track-type-conflict", "窗帘轨道项需要选择轨道 SKU", committed)
        continue
      }
      if (main?.specs?.track_type != null && selected.specs?.track_type != null && main.specs.track_type !== selected.specs.track_type) {
        issue(material.id, "track-compatibility-conflict", "轨道类型与主电机/套装不一致", committed)
        continue
      }
    }
    if (material.quantity == null || !material.unit) continue
    const line: PointMaterialLineItem = { pointId: point.id, materialId: material.id, productId: selected.id, role: material.role, quantity: material.quantity, unit: material.unit, product: selected }
    if (material.physicalDeviceId) {
      const previous = physicalDevices.get(material.physicalDeviceId)
      if (physicalDevices.has(material.physicalDeviceId)) {
        if (!previous || previous.productId !== line.productId || previous.quantity !== line.quantity || previous.unit !== line.unit) {
          issue(material.id, "physical-device-conflict", "同一实物的 SKU、数量或单位冲突，请核对实体身份")
          if (previous) lineItems.splice(lineItems.indexOf(previous), 1)
          physicalDevices.set(material.physicalDeviceId, null)
        }
        continue
      }
      physicalDevices.set(material.physicalDeviceId, line)
    }
    lineItems.push(line)
  }
  return { lineItems, diagnostics }
}

/** An explicit optional template: no supplier SKU, measured length or accessory quantity is invented. */
export function createCurtainMaterialTemplate(id: string): PointMaterial[] {
  return [{ id: `${id}-track`, productId: "", role: "track", quantity: null, unit: "米", required: true, included: false }]
}
