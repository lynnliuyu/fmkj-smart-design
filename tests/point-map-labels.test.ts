import { describe, expect, it } from "vitest"
import { pointMapMarkerLabel } from "../lib/point-map-labels"

describe("customer point-map labels", () => {
  it.each([
    ["switch-1", "单开"],
    ["switch-2", "双开"],
    ["switch-3", "三开"],
    ["switch-4", "四开"],
    ["camera", "监控"],
    ["ap", "AP"],
    ["network-controller", "AC"],
    ["panel-small", "四寸屏"],
    ["panel-large", "中控大屏"],
    ["gateway", "中枢网关"],
  ])("maps %s to %s", (iconId, expected) => {
    expect(pointMapMarkerLabel({ iconId, name: "旧设备名称" })).toBe(expected)
  })

  it("uses the point name only for an unmapped legacy icon", () => {
    expect(pointMapMarkerLabel({ iconId: "legacy-icon", name: "旧设备名称" })).toBe("旧设备名称")
  })
})
