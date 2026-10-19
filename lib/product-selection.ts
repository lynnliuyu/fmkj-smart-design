import { findDeviceType, missingRequiredDeviceSpecs, normalizeDeviceSpecs, validateDeviceSpecs, type DeviceSpecs } from "./device-types"

export type { DeviceSpecs } from "./device-types"

export type ProductSelectionFields = {
  catalogKind?: "legacy" | "series" | "sku"
  deviceTypeId?: string | null
  parentProductId?: string | null
  manufacturerModel?: string | null
  specs?: DeviceSpecs
  protocols?: string[]
  capabilities?: string[]
  selectionStatus?: "pending" | "verified" | "conflict"
  selectionEvidence?: string | null
  pricingStatus?: "pending" | "verified" | "conflict"
  pricingEvidence?: string | null
  mappingRevision?: number
}

export type SelectionProduct = ProductSelectionFields & {
  id: string
  name: string
  sku?: string | null
  unit: string
  status?: string | null
  category?: string | null
}

export type PointSelectionSnapshot = {
  productId: string
  mappingRevision: number
  deviceTypeId: string
  sku: string
  name: string
  manufacturerModel: string | null
  specs: DeviceSpecs
  protocols: string[]
  capabilities: string[]
  unit: string
  verifiedAt: string
  verifiedBy?: string
}

export type ProductSelectionSnapshot = PointSelectionSnapshot
export type ProductCompatibility = { status: "compatible" | "incomplete" | "incompatible"; reasons: string[] }

export const DEVICE_PROTOCOLS = ["wifi", "ethernet", "zigbee", "bluetooth", "ble-mesh", "thread", "matter", "knx", "rs485", "infrared", "dry-contact", "proprietary", "analog"] as const
export const DEVICE_CAPABILITIES = ["load-control", "scene-trigger", "dimming", "gateway", "voice-control", "curtain-control", "monitoring", "routing", "ap-management", "wireless-access", "poe-input", "poe-output", "sensing", "audio", "hvac-control"] as const
export const protocolOptions = [
  { value: "wifi", label: "Wi-Fi" }, { value: "ethernet", label: "以太网" }, { value: "zigbee", label: "Zigbee" }, { value: "bluetooth", label: "蓝牙" }, { value: "ble-mesh", label: "蓝牙 Mesh" }, { value: "thread", label: "Thread" }, { value: "matter", label: "Matter" }, { value: "knx", label: "KNX" }, { value: "rs485", label: "RS-485" }, { value: "infrared", label: "红外" }, { value: "dry-contact", label: "干接点" }, { value: "proprietary", label: "厂商专有协议" }, { value: "analog", label: "模拟信号" },
] as const
export const capabilityOptions = [
  { value: "load-control", label: "负载控制" }, { value: "scene-trigger", label: "场景触发" }, { value: "dimming", label: "调光" }, { value: "gateway", label: "子设备网关" }, { value: "voice-control", label: "语音控制" }, { value: "curtain-control", label: "窗帘控制" }, { value: "monitoring", label: "视频监控" }, { value: "routing", label: "路由" }, { value: "ap-management", label: "AP 管理" }, { value: "wireless-access", label: "无线接入" }, { value: "poe-input", label: "PoE 受电" }, { value: "poe-output", label: "PoE 供电" }, { value: "sensing", label: "传感检测" }, { value: "audio", label: "音频播放" }, { value: "hvac-control", label: "暖通控制" },
] as const

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function normalizeEnumArray(value: unknown, allowed: readonly string[], field: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length > 64 || value.some((entry) => typeof entry !== "string" || !allowed.includes(entry))) {
    errors.push(`${field}：请使用允许的枚举值数组`)
    return []
  }
  return [...new Set(value as string[])]
}

/** Validate only structured selection fields; omitted fields remain omitted for safe partial updates. */
export function validateProductSelectionFields(value: unknown): { fields: ProductSelectionFields; errors: string[] } {
  const fields: ProductSelectionFields = {}
  const errors: string[] = []
  if (!value || typeof value !== "object" || Array.isArray(value)) return { fields, errors: ["选型信息必须为对象"] }
  const input = value as Record<string, unknown>
  const enums = { catalogKind: ["legacy", "series", "sku"], selectionStatus: ["pending", "verified", "conflict"], pricingStatus: ["pending", "verified", "conflict"] } as const
  for (const [key, allowed] of Object.entries(enums)) {
    if (!own(input, key)) continue
    const raw = input[key]
    if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) errors.push(`${key}：无效状态`)
    else Object.assign(fields, { [key]: raw })
  }
  for (const key of ["deviceTypeId", "parentProductId", "manufacturerModel", "selectionEvidence", "pricingEvidence"] as const) {
    if (!own(input, key)) continue
    const raw = input[key]
    if (raw == null) fields[key] = null
    else if (typeof raw !== "string" || raw.length > (key.endsWith("Evidence") ? 10000 : 500)) errors.push(`${key}：无效文字`)
    else fields[key] = raw.trim() || null
  }
  if (fields.deviceTypeId && !findDeviceType(fields.deviceTypeId)) errors.push("deviceTypeId：未知设备类型")
  if (own(input, "specs")) {
    const result = validateDeviceSpecs(fields.deviceTypeId, input.specs)
    fields.specs = result.specs
    errors.push(...result.errors)
  }
  if (own(input, "protocols")) fields.protocols = normalizeEnumArray(input.protocols, DEVICE_PROTOCOLS, "protocols", errors)
  if (own(input, "capabilities")) fields.capabilities = normalizeEnumArray(input.capabilities, DEVICE_CAPABILITIES, "capabilities", errors)
  if (own(input, "mappingRevision")) {
    if (typeof input.mappingRevision !== "number" || !Number.isSafeInteger(input.mappingRevision) || input.mappingRevision < 0) errors.push("mappingRevision：必须为非负整数")
    else fields.mappingRevision = input.mappingRevision
  }
  if (fields.selectionStatus === "verified") {
    if (fields.catalogKind !== "sku") errors.push("仅明确的具体 SKU 可以核验选型")
    if (!fields.deviceTypeId || !findDeviceType(fields.deviceTypeId)) errors.push("选型核验缺少有效设备类型")
    if (!fields.selectionEvidence) errors.push("选型核验需要参数依据")
    errors.push(...missingRequiredDeviceSpecs(fields.deviceTypeId, fields.specs ?? {}).map((name) => `选型核验缺少${name}`))
  }
  if (fields.pricingStatus === "verified" && !fields.pricingEvidence) errors.push("价格核验需要价格依据")
  return { fields, errors }
}

export function normalizeProductSelectionFields(value: unknown): ProductSelectionFields {
  const result = validateProductSelectionFields(value)
  if (result.errors.length) throw new Error(result.errors.join("；"))
  return result.fields
}

/** Full read DTO for legacy rows; defaults never claim that parameters or prices are verified. */
export function productSelectionWithDefaults(value: unknown): Required<ProductSelectionFields> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("选型信息必须为对象")
  const present = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
  return { catalogKind: "legacy", deviceTypeId: null, parentProductId: null, manufacturerModel: null, specs: {}, protocols: [], capabilities: [], selectionStatus: "pending", selectionEvidence: null, pricingStatus: "pending", pricingEvidence: null, mappingRevision: 1, ...normalizeProductSelectionFields(present) }
}

/** No name/spec-description/tag/price heuristics are used in compatibility decisions. */
export function evaluateProductCompatibility(point: { deviceTypeId?: string | null; requirements?: DeviceSpecs }, product: SelectionProduct): ProductCompatibility {
  const incomplete: string[] = []
  const incompatible: string[] = []
  const pointType = findDeviceType(point.deviceTypeId)
  const productType = findDeviceType(product.deviceTypeId)
  if (!pointType) incomplete.push("点位设备类型待确认")
  if (!productType) incomplete.push("产品设备类型待补充")
  if (pointType && productType && pointType.id !== productType.id) incompatible.push(`设备类型不符：点位需要${pointType.name}，产品为${productType.name}`)
  if (product.status !== "active" && product.status !== "approved") {
    if (product.status) incompatible.push("产品未通过目录审核或已停用")
    else incomplete.push("产品目录状态未知")
  }
  if (product.catalogKind !== "sku") incomplete.push(product.catalogKind === "series" ? "产品系列尚未指定具体 SKU" : "旧产品尚未整理为具体 SKU")
  if (!product.sku?.trim()) incomplete.push("产品 SKU 编号待补充")
  if (product.selectionStatus === "conflict") incompatible.push("产品参数存在核验冲突")
  else if (product.selectionStatus !== "verified") incomplete.push("产品参数尚未核验")
  if (!product.selectionEvidence?.trim()) incomplete.push("产品参数缺少核验依据")
  const productSpecs = validateDeviceSpecs(product.deviceTypeId, product.specs)
  incomplete.push(...productSpecs.errors.map((reason) => `产品参数无效：${reason}`))
  incomplete.push(...missingRequiredDeviceSpecs(product.deviceTypeId, productSpecs.specs).map((name) => `产品缺少${name}`))
  const requirements = validateDeviceSpecs(point.deviceTypeId, point.requirements)
  incomplete.push(...requirements.errors.map((reason) => `点位要求无效：${reason}`))
  incomplete.push(...(pointType?.specs.filter((field) => field.requiredForPoint && requirements.specs[field.key] == null).map((field) => `点位${field.name}待确认`) ?? []))
  if (pointType && productType && pointType.id === productType.id) {
    for (const [key, needed] of Object.entries(requirements.specs)) {
      const actual = productSpecs.specs[key]
      const field = pointType.specs.find((definition) => definition.key === key)!
      if (actual == null) { incomplete.push(`产品${field.name}未知`); continue }
      let matches = actual === needed
      if (typeof actual === "number" && typeof needed === "number") {
        if (field.comparison === "minimum") matches = actual >= needed
        if (field.comparison === "maximum") matches = actual <= needed
      }
      if (key === "environment" && actual === "indoor-outdoor") matches = true
      if (key === "network" && actual === "ethernet-wifi" && (needed === "ethernet" || needed === "wifi")) matches = true
      if (!matches) incompatible.push(`${field.name}不符：要求 ${String(needed)}，产品 ${String(actual)}`)
    }
  }
  return incompatible.length ? { status: "incompatible", reasons: [...incompatible, ...incomplete] } : incomplete.length ? { status: "incomplete", reasons: incomplete } : { status: "compatible", reasons: [] }
}

/** Use for explicit user intent changes only. Legacy placeholder icons are not evidence. */
export function deviceIntentForIcon(iconId: string): { deviceTypeId: string; requirements: DeviceSpecs } | undefined {
  const switches = /^switch-([1-4])$/.exec(iconId)
  if (switches) return { deviceTypeId: "wall-switch", requirements: { button_count: Number(switches[1]) } }
  if (iconId === "panel-small") return { deviceTypeId: "touch-control-panel", requirements: { screen_size_in: 4 } }
  if (iconId === "panel-large") return { deviceTypeId: "touch-control-panel", requirements: {} }
  if (iconId === "scene-switch") return { deviceTypeId: "scene-panel", requirements: {} }
  const types: Record<string, string> = { camera: "camera", nvr: "nvr", door: "door-lock", doorbell: "doorbell", sensor: "motion-sensor", "temperature-sensor": "temperature-humidity-sensor", "smoke-sensor": "smoke-sensor", "water-leak-sensor": "water-leak-sensor", curtain: "curtain-kit", "dimmer-switch": "dimmer-controller", socket: "socket", "socket-usb": "usb-socket", "floor-socket": "floor-socket", "ac-wall": "air-conditioner", "vrf-controller": "hvac-controller", "exhaust-fan": "exhaust-fan", "water-heater": "water-heater", gateway: "smart-home-gateway", speaker: "smart-speaker", ap: "wireless-ap", "network-controller": "wlan-controller", "poe-switch": "network-switch", "mesh-node": "mesh-node", "data-point": "data-outlet", downlight: "downlight", spotlight: "spotlight", "track-light": "track-light", "pendant-light": "pendant-light", "wall-light": "wall-light", "ceiling-light": "ceiling-light", "desk-light": "desk-light", "light-strip": "light-strip", "sky-light": "sky-light", "smart-bulb": "smart-bulb", "tv-point": "tv-outlet", "distribution-board": "distribution-board", "drying-rack": "drying-rack" }
  const deviceTypeId = types[iconId]
  return deviceTypeId ? { deviceTypeId, requirements: {} } : undefined
}

const typesWithoutExactSymbol = new Set(["track-socket", "lighting-power-supply", "panel-light", "grille-light", "fan-light", "accessory", "installation-service"])

/** Undefined means that the structured data cannot identify a sufficiently specific symbol. */
export function iconForSelectionProduct(product: Pick<SelectionProduct, "deviceTypeId" | "specs">): string | undefined {
  const type = findDeviceType(product.deviceTypeId)
  if (!type || typesWithoutExactSymbol.has(type.id)) return undefined
  if (type.id === "wall-switch") {
    const count = product.specs?.button_count
    return typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 4 ? `switch-${count}` : undefined
  }
  if (type.id === "touch-control-panel") {
    const size = product.specs?.screen_size_in
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size <= 4.5 ? "panel-small" : "panel-large" : undefined
  }
  return type.defaultIconId
}

/** 材料或服务类（轨道、电源等）不按实体点位计数；仅按单件计量的产品可以。 */
export function isCountableByPoint(product: Pick<SelectionProduct, "deviceTypeId" | "unit">): boolean {
  return !["curtain-track", "lighting-power-supply"].includes(product.deviceTypeId ?? "") && ["个", "台", "件", "套", "只", "块", "盏", "支", "组"].includes(product.unit.trim())
}

export function canExpandProductToPoints(product: Pick<SelectionProduct, "deviceTypeId" | "specs" | "unit">): boolean {
  return Boolean(iconForSelectionProduct(product)) && isCountableByPoint(product)
}

export function normalizePointSelectionSnapshot(value: unknown): PointSelectionSnapshot | undefined {
  if (value == null) return undefined
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("选型快照必须为对象")
  const input = value as Record<string, unknown>
  const allowed = new Set(["productId", "mappingRevision", "deviceTypeId", "sku", "name", "manufacturerModel", "specs", "protocols", "capabilities", "unit", "verifiedAt", "verifiedBy"])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("选型快照含不支持的字段")
  const strings: Record<string, string> = {}
  for (const key of ["productId", "deviceTypeId", "sku", "name", "unit", "verifiedAt"] as const) {
    if (typeof input[key] !== "string" || !(input[key] as string).trim() || (input[key] as string).length > 500) throw new Error(`选型快照 ${key} 无效`)
    strings[key] = (input[key] as string).trim()
  }
  if (!findDeviceType(strings.deviceTypeId)) throw new Error("选型快照设备类型未知")
  if (typeof input.mappingRevision !== "number" || !Number.isSafeInteger(input.mappingRevision) || input.mappingRevision < 0) throw new Error("选型快照版本无效")
  if (!/^\d{4}-\d{2}-\d{2}T/.test(strings.verifiedAt) || !Number.isFinite(Date.parse(strings.verifiedAt))) throw new Error("选型快照核验时间无效")
  if (input.manufacturerModel != null && (typeof input.manufacturerModel !== "string" || input.manufacturerModel.length > 500)) throw new Error("选型快照厂商型号无效")
  if (input.verifiedBy != null && (typeof input.verifiedBy !== "string" || !input.verifiedBy.trim() || input.verifiedBy.length > 500)) throw new Error("选型快照核验人无效")
  const errors: string[] = []
  const protocols = normalizeEnumArray(input.protocols, DEVICE_PROTOCOLS, "protocols", errors)
  const capabilities = normalizeEnumArray(input.capabilities, DEVICE_CAPABILITIES, "capabilities", errors)
  if (errors.length) throw new Error(errors.join("；"))
  return { productId: strings.productId, mappingRevision: input.mappingRevision, deviceTypeId: strings.deviceTypeId, sku: strings.sku, name: strings.name, manufacturerModel: typeof input.manufacturerModel === "string" ? input.manufacturerModel.trim() || null : null, specs: normalizeDeviceSpecs(strings.deviceTypeId, input.specs), protocols, capabilities, unit: strings.unit, verifiedAt: strings.verifiedAt, ...(typeof input.verifiedBy === "string" ? { verifiedBy: input.verifiedBy.trim() } : {}) }
}
