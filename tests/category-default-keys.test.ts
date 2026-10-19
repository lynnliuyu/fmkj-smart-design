import { describe, expect, it } from "vitest"
import { leafForKeyCount, servesKeyCount } from "../lib/category-default-keys"

type P = { id: string; parentProductId?: string | null; specs?: Record<string, unknown> }
const main: P = { id: "m", parentProductId: null, specs: {} }
const two: P = { id: "c2", parentProductId: "m", specs: { button_count: 2 } }
const own3: P = { id: "o3", parentProductId: null, specs: { button_count: 3 } }
const all = [main, two, own3]

describe("key count resolution", () => {
  it("finds the child spec under a main model", () => {
    expect(leafForKeyCount(main, 2, all)?.id).toBe("c2")
  })
  it("uses a product that carries the key count itself", () => {
    expect(leafForKeyCount(own3, 3, all)?.id).toBe("o3")
  })
  it("returns nothing when the key count is missing", () => {
    expect(leafForKeyCount(main, 4, all)).toBeUndefined()
    expect(servesKeyCount(main, 4, all)).toBe(false)
  })
  it("treats zero as every key count", () => {
    expect(servesKeyCount(main, 0, all)).toBe(true)
  })
})
