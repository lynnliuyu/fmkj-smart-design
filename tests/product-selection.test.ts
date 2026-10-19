import { describe, expect, it } from "vitest"
import { findDeviceType, normalizeDeviceSpecs, validateDeviceSpecs, deviceTypes } from "../lib/device-types"
import { pointIconDefinitions } from "../lib/point-icons"
import {
  canExpandProductToPoints,
  capabilityOptions,
  DEVICE_CAPABILITIES,
  DEVICE_PROTOCOLS,
  deviceIntentForIcon,
  evaluateProductCompatibility,
  iconForSelectionProduct,
  normalizePointSelectionSnapshot,
  normalizeProductSelectionFields,
  productSelectionWithDefaults,
  protocolOptions,
  validateProductSelectionFields,
  type PointSelectionSnapshot,
  type SelectionProduct,
} from "../lib/product-selection"

const switchPoint = { deviceTypeId: "wall-switch", requirements: { button_count: 3, relay_count: 2, wiring: "neutral" } }
const switchProduct = (overrides: Partial<SelectionProduct> = {}): SelectionProduct => ({
  id: "switch-sku-3", name: "具体三键开关", sku: "MODEL-3-N", unit: "个", status: "approved", catalogKind: "sku", deviceTypeId: "wall-switch", specs: { button_count: 3, relay_count: 3, wiring: "neutral" }, selectionStatus: "verified", selectionEvidence: "厂商安装说明第3页，三键/三路/零火", mappingRevision: 4, ...overrides,
})

describe("device type schema", () => {
  it("covers every existing symbol with an explicit device intent and stable type", () => {
    expect(new Set(deviceTypes.map((type) => type.id)).size).toBe(deviceTypes.length)
    for (const icon of pointIconDefinitions) {
      const intent = deviceIntentForIcon(icon.id)
      expect(intent, icon.id).toBeDefined()
      expect(findDeviceType(intent!.deviceTypeId), icon.id).toBeDefined()
    }
  })

  it("omits unknown null parameters but preserves explicit zero relay and false capabilities", () => {
    expect(normalizeDeviceSpecs("wall-switch", { button_count: null, relay_count: 0, wiring: "  neutral  " })).toEqual({ relay_count: 0, wiring: "neutral" })
    expect(normalizeDeviceSpecs("network-switch", { poe_output: false })).toEqual({ poe_output: false })
    expect(normalizeDeviceSpecs(undefined, null)).toEqual({})
  })

  it.each([
    ["wall-switch", { button_count: "3" }],
    ["wall-switch", { button_count: 0 }],
    ["wall-switch", { button_count: 1.5 }],
    ["wall-switch", { relay_count: -1 }],
    ["wall-switch", { max_load_w: Infinity }],
    ["wall-switch", { wiring: "待核" }],
    ["wall-switch", { wiring: "" }],
    ["camera", { environment: "office" }],
    ["camera", { button_count: 3 }],
    ["not-a-type", { power: "poe" }],
    ["network-switch", { poe_output: "false" }],
  ])("rejects unsupported or invalid parameter values for %s", (typeId, specs) => {
    expect(() => normalizeDeviceSpecs(typeId, specs)).toThrow()
    expect(validateDeviceSpecs(typeId, specs).errors.length).toBeGreaterThan(0)
  })

  it("keeps pending product data partial without silently accepting invalid fields", () => {
    expect(normalizeProductSelectionFields({ deviceTypeId: "wall-switch", selectionStatus: "pending", specs: {} })).toEqual({ deviceTypeId: "wall-switch", selectionStatus: "pending", specs: {} })
    expect(normalizeProductSelectionFields({})).toEqual({})
    expect(() => normalizeProductSelectionFields({ deviceTypeId: "wall-switch", specs: { button_count: "三键" } })).toThrow()
  })

  it("cannot mark a series, evidence-free record or unknown key count verified", () => {
    for (const input of [
      { catalogKind: "series", deviceTypeId: "wall-switch", specs: { button_count: 3, relay_count: 3, wiring: "neutral" }, selectionEvidence: "厂商资料" },
      { catalogKind: "sku", deviceTypeId: "wall-switch", specs: { button_count: 3, relay_count: 3, wiring: "neutral" } },
      { catalogKind: "sku", deviceTypeId: "wall-switch", specs: { relay_count: 3, wiring: "neutral" }, selectionEvidence: "厂商资料" },
    ]) expect(validateProductSelectionFields({ ...input, selectionStatus: "verified" }).errors.length).toBeGreaterThan(0)
  })

  it("requires PoE budget and standard only when a network switch provides PoE", () => {
    const base = { catalogKind: "sku", deviceTypeId: "network-switch", selectionStatus: "verified", selectionEvidence: "厂商规格书", specs: { power: "ac-mains", port_count: 8, poe_output: false } }
    expect(validateProductSelectionFields(base).errors).toEqual([])
    const result = validateProductSelectionFields({ ...base, specs: { ...base.specs, poe_output: true } })
    expect(result.errors).toContain("选型核验缺少PoE 标准")
    expect(result.errors).toContain("选型核验缺少PoE 总功率")
  })

  it("does not confuse verified parameters with verified pricing", () => {
    expect(validateProductSelectionFields({ ...switchProduct(), pricingStatus: "pending" }).errors).toEqual([])
    expect(validateProductSelectionFields({ pricingStatus: "verified" }).errors).toContain("价格核验需要价格依据")
  })

  it("normalizes legacy read DTOs conservatively and keeps enum choices consistent", () => {
    expect(productSelectionWithDefaults({ deviceTypeId: undefined })).toMatchObject({ catalogKind: "legacy", deviceTypeId: null, selectionStatus: "pending", pricingStatus: "pending", mappingRevision: 1, specs: {}, protocols: [], capabilities: [] })
    expect(protocolOptions.map((option) => option.value)).toEqual([...DEVICE_PROTOCOLS])
    expect(capabilityOptions.map((option) => option.value)).toEqual([...DEVICE_CAPABILITIES])
    expect(() => productSelectionWithDefaults({ protocols: ["米家"] })).toThrow()
  })
})

describe("structured product compatibility", () => {
  it("matches key count exactly and output capacity independently", () => {
    expect(evaluateProductCompatibility(switchPoint, switchProduct())).toEqual({ status: "compatible", reasons: [] })
    expect(evaluateProductCompatibility(switchPoint, switchProduct({ specs: { button_count: 3, relay_count: 1, wiring: "neutral" } })).status).toBe("incompatible")
    expect(evaluateProductCompatibility(switchPoint, switchProduct({ specs: { button_count: 4, relay_count: 3, wiring: "neutral" } })).status).toBe("incompatible")
  })

  it("compares installation depth as available space and power as required capacity", () => {
    const point = { ...switchPoint, requirements: { ...switchPoint.requirements, max_load_w: 500, box_depth_mm: 50 } }
    expect(evaluateProductCompatibility(point, switchProduct({ specs: { ...switchProduct().specs, max_load_w: 1000, box_depth_mm: 35 } })).status).toBe("compatible")
    expect(evaluateProductCompatibility(point, switchProduct({ specs: { ...switchProduct().specs, max_load_w: 1000, box_depth_mm: 60 } })).status).toBe("incompatible")
  })

  it("does not treat omitted critical point requirements as suitable installation conditions", () => {
    const result = evaluateProductCompatibility({ deviceTypeId: "wall-switch", requirements: { button_count: 3 } }, switchProduct())
    expect(result.status).toBe("incomplete")
    expect(result.reasons).toContain("点位继电器路数待确认")
    expect(result.reasons).toContain("点位接线方式待确认")
  })

  const incompleteOverrides: Partial<SelectionProduct>[] = [
    { catalogKind: "series" as const },
    { catalogKind: undefined },
    { sku: "" },
    { selectionStatus: "pending" as const },
    { selectionEvidence: "" },
    { status: undefined },
    { specs: { button_count: 3, relay_count: 3 } },
    { specs: { button_count: 3, relay_count: 3, wiring: "neutral", max_load_w: "待核" } },
  ]
  it.each(incompleteOverrides)("keeps incomplete product metadata pending: %o", (overrides) => {
    expect(evaluateProductCompatibility(switchPoint, switchProduct(overrides)).status).toBe("incomplete")
  })

  it.each(["inactive", "rejected", "pending_review", "deleted"])("rejects unapproved or unavailable catalog status %s", (status) => {
    expect(evaluateProductCompatibility(switchPoint, switchProduct({ status })).status).toBe("incompatible")
  })

  it("reports known incompatibility even when other fields are incomplete", () => {
    const result = evaluateProductCompatibility(switchPoint, switchProduct({ selectionStatus: "pending", specs: { button_count: 2 } }))
    expect(result.status).toBe("incompatible")
    expect(result.reasons.some((reason) => reason.includes("物理按键数不符"))).toBe(true)
    expect(result.reasons.some((reason) => reason.includes("未核验"))).toBe(true)
  })

  it("cannot match AP to an APP-enabled switch or infer keys from a price list", () => {
    const product = { ...switchProduct(), name: "APP 控制，1/2/3/4键渠道价格，支持空调 AC PoE 场景" }
    expect(evaluateProductCompatibility({ deviceTypeId: "wireless-ap", requirements: { power: "poe", installation: "ceiling" } }, product).status).toBe("incompatible")
    expect(iconForSelectionProduct(product)).toBe("switch-3")
    expect(iconForSelectionProduct({ ...product, specs: {} })).toBeUndefined()
    expect(iconForSelectionProduct({ ...product, deviceTypeId: null })).toBeUndefined()
  })

  it("keeps a four-inch screen's type despite HVAC/gateway descriptions", () => {
    const panel = switchProduct({ name: "C2 支持空调及网关", deviceTypeId: "touch-control-panel", specs: { screen_size_in: 4, power: "ac-mains", relay_count: 0 } })
    expect(iconForSelectionProduct(panel)).toBe("panel-small")
    expect(evaluateProductCompatibility({ deviceTypeId: "touch-control-panel", requirements: { screen_size_in: 4, power: "ac-mains", relay_count: 0 } }, panel).status).toBe("compatible")
    expect(evaluateProductCompatibility({ deviceTypeId: "smart-home-gateway" }, panel).status).toBe("incompatible")
  })

  it("requires AP power and mounting, without demanding AC capacity on a point", () => {
    const ap = switchProduct({ deviceTypeId: "wireless-ap", specs: { power: "poe", installation: "ceiling", wireless_standard: "802.11ax" } })
    expect(evaluateProductCompatibility({ deviceTypeId: "wireless-ap", requirements: { power: "poe", installation: "ceiling" } }, ap).status).toBe("compatible")
    expect(evaluateProductCompatibility({ deviceTypeId: "wireless-ap", requirements: { power: "poe" } }, ap).status).toBe("incomplete")
  })

  it("allows dual-environment/network cameras when the requested outdoor conditions are satisfied", () => {
    const camera = switchProduct({ deviceTypeId: "camera", specs: { environment: "indoor-outdoor", power: "poe", network: "ethernet-wifi" } })
    const point = { deviceTypeId: "camera", requirements: { environment: "outdoor", power: "poe", network: "ethernet" } }
    expect(evaluateProductCompatibility(point, camera).status).toBe("compatible")
    expect(evaluateProductCompatibility(point, { ...camera, specs: { ...camera.specs, environment: "indoor" } }).status).toBe("incompatible")
  })
})

describe("device intent and physical point expansion", () => {
  it("does not infer relay count from the explicit three-key icon action", () => {
    expect(deviceIntentForIcon("switch-3")).toEqual({ deviceTypeId: "wall-switch", requirements: { button_count: 3 } })
    expect(deviceIntentForIcon("panel-small")).toEqual({ deviceTypeId: "touch-control-panel", requirements: { screen_size_in: 4 } })
    expect(deviceIntentForIcon("custom-future-icon")).toBeUndefined()
  })

  it("does not default unknown switches or screens to a specific key count or screen size", () => {
    expect(iconForSelectionProduct({ deviceTypeId: "wall-switch", specs: {} })).toBeUndefined()
    expect(iconForSelectionProduct({ deviceTypeId: "touch-control-panel", specs: {} })).toBeUndefined()
    expect(iconForSelectionProduct({ deviceTypeId: "touch-control-panel", specs: { screen_size_in: 10 } })).toBe("panel-large")
  })

  it("does not create rounded physical points for metre materials or unrelated accessory icons", () => {
    expect(canExpandProductToPoints(switchProduct())).toBe(true)
    expect(canExpandProductToPoints(switchProduct({ unit: "米" }))).toBe(false)
    expect(canExpandProductToPoints(switchProduct({ deviceTypeId: "curtain-track", unit: "套" }))).toBe(false)
    expect(canExpandProductToPoints(switchProduct({ deviceTypeId: "lighting-power-supply" }))).toBe(false)
    expect(canExpandProductToPoints(switchProduct({ deviceTypeId: "accessory", specs: { accessory_compatibility: "厂家轨道及传动头" } }))).toBe(false)
    expect(canExpandProductToPoints(switchProduct({ deviceTypeId: "installation-service", specs: { scope: "安装调试" } }))).toBe(false)
    expect(iconForSelectionProduct({ deviceTypeId: "panel-light" })).toBeUndefined()
  })
})

describe("selection snapshot validation", () => {
  const snapshot: PointSelectionSnapshot = { productId: "switch-sku-3", mappingRevision: 4, deviceTypeId: "wall-switch", sku: "MODEL-3-N", name: "具体三键开关", manufacturerModel: null, specs: { button_count: 3, relay_count: 3, wiring: "neutral" }, protocols: ["ble-mesh"], capabilities: ["load-control", "scene-trigger"], unit: "个", verifiedAt: "2026-10-14T00:00:00.000Z", verifiedBy: "reviewer-1" }

  it("round-trips versioned structured snapshots without mutating stored specs", () => {
    expect(normalizePointSelectionSnapshot(snapshot)).toEqual(snapshot)
    expect(normalizePointSelectionSnapshot(null)).toBeUndefined()
    expect(normalizePointSelectionSnapshot(snapshot)?.specs).not.toBe(snapshot.specs)
  })

  it.each([
    { ...snapshot, mappingRevision: -1 },
    { ...snapshot, mappingRevision: 1.5 },
    { ...snapshot, deviceTypeId: "unknown" },
    { ...snapshot, protocols: ["米家"] },
    { ...snapshot, verifiedAt: "tomorrow" },
    { ...snapshot, verifiedBy: "" },
    { ...snapshot, specs: { relay_count: "3" } },
    { ...snapshot, price: 0 },
  ])("rejects malformed, unversioned or unknown snapshot fields", (value) => {
    expect(() => normalizePointSelectionSnapshot(value)).toThrow()
  })
})
