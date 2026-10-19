import { describe, expect, it } from "vitest"
import { classifyProductForPointMap, matchesProductPointFilter, POINT_MATERIAL_CATEGORY, UNKNOWN_POINT_ICON } from "../lib/product-point-classification"

describe("product navigation by point-map category and symbol", () => {
  it("separates one through four physical keys using structured specifications", () => {
    const switches = [1, 2, 3, 4].map((button_count) => ({ deviceTypeId: "wall-switch", specs: { button_count } }))
    expect(switches.map((product) => classifyProductForPointMap(product).iconId)).toEqual(["switch-1", "switch-2", "switch-3", "switch-4"])
    expect(switches.filter((product) => matchesProductPointFilter(product, { category: "开关", iconId: "switch-3" }))).toEqual([switches[2]])
  })
  it("keeps a mixed-key series in the switch category without guessing an exact icon", () => {
    expect(classifyProductForPointMap({ deviceTypeId: "wall-switch" })).toMatchObject({ category: "开关", iconId: UNKNOWN_POINT_ICON })
  })
  it("classifies a four-inch screen by its role even if its old catalog category is a switch", () => {
    expect(classifyProductForPointMap({ category: "开关", deviceTypeId: "touch-control-panel", specs: { screen_size_in: 4 } })).toMatchObject({ category: "网关中控", iconId: "panel-small" })
    expect(classifyProductForPointMap({ deviceTypeId: "touch-control-panel", specs: { screen_size_in: 10 } }).iconId).toBe("panel-large")
  })
  it("does not infer a screen size, AP role or key count from a legacy category", () => {
    expect(classifyProductForPointMap({ category: "网关中控" }).iconId).toBe(UNKNOWN_POINT_ICON)
    expect(classifyProductForPointMap({ category: "开关", specs: { button_count: 4 } }).iconId).toBe(UNKNOWN_POINT_ICON)
    expect(classifyProductForPointMap({ deviceTypeId: "not-a-real-type", category: "全屋wifi" }).iconId).toBe(UNKNOWN_POINT_ICON)
  })
  it("separates wireless AC from air conditioning and PoE from AP", () => {
    const role = (deviceTypeId: string) => classifyProductForPointMap({ deviceTypeId })
    expect(role("wlan-controller")).toMatchObject({ category: "全屋wifi", iconId: "network-controller" })
    expect(role("hvac-controller")).toMatchObject({ category: "暖通控制", iconId: "vrf-controller" })
    expect(role("network-switch").iconId).toBe("poe-switch")
    expect(role("wireless-ap").iconId).toBe("ap")
  })
  it("keeps curtain motor, track and kit under the shared curtain symbol", () => {
    expect(["curtain-motor", "curtain-track", "curtain-kit"].map((deviceTypeId) => classifyProductForPointMap({ deviceTypeId }).iconId)).toEqual(["curtain", "curtain", "curtain"])
  })
  it("keeps materials and services in an explicit navigation category", () => {
    for (const deviceTypeId of ["accessory", "installation-service"]) expect(classifyProductForPointMap({ deviceTypeId })).toMatchObject({ category: POINT_MATERIAL_CATEGORY, iconId: UNKNOWN_POINT_ICON })
  })
  it("retains missing-symbol device types without misrepresenting them as downlights", () => {
    expect(classifyProductForPointMap({ deviceTypeId: "lighting-power-supply" })).toMatchObject({ category: "智能灯具", iconId: UNKNOWN_POINT_ICON })
    expect(classifyProductForPointMap({ category: "unknown" })).toMatchObject({ category: "待整理", iconId: UNKNOWN_POINT_ICON })
  })
  it("combines category and symbol filters without changing any product data", () => {
    const product = Object.freeze({ deviceTypeId: "wall-switch", specs: Object.freeze({ button_count: 3 }) })
    expect(matchesProductPointFilter(product, { category: "all", iconId: "all" })).toBe(true)
    expect(matchesProductPointFilter(product, { category: "网关中控", iconId: "switch-3" })).toBe(false)
    expect(matchesProductPointFilter(product, { category: "开关", iconId: "switch-3" })).toBe(true)
  })
})
