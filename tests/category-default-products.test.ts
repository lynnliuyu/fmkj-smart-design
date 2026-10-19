import { describe, expect, it } from "vitest"
import { categoryDefaultKey, defaultButtonCountForPoint } from "../lib/point-map-procurement"

describe("category default keys", () => {
  it("reads the button count from a switch icon", () => {
    expect(defaultButtonCountForPoint({ iconId: "switch-1" })).toBe(1)
    expect(defaultButtonCountForPoint({ iconId: "switch-4" })).toBe(4)
  })

  it("prefers an explicit button_count requirement over the icon", () => {
    expect(defaultButtonCountForPoint({ iconId: "switch-1", requirements: { button_count: 3 } })).toBe(3)
  })

  it("keys switches by device type and button count", () => {
    expect(categoryDefaultKey({ iconId: "switch-2" }, "wall-switch")).toBe("wall-switch:2")
  })

  it("keys other categories by device type only", () => {
    expect(categoryDefaultKey({ iconId: "ap" }, "wireless-ap")).toBe("wireless-ap")
  })
})
