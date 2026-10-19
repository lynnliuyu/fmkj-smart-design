import { describe, expect, it } from "vitest"
import { defaultSellingPrice } from "../lib/product-pricing"

describe("default selling price", () => {
  it("keeps a filled selling price", () => {
    expect(defaultSellingPrice(220, 138)).toBe(220)
  })
  it("uses the cost when the selling price is empty or zero", () => {
    expect(defaultSellingPrice(null, 138)).toBe(138)
    expect(defaultSellingPrice(0, 138)).toBe(138)
  })
  it("returns zero when neither is filled", () => {
    expect(defaultSellingPrice(undefined, null)).toBe(0)
  })
})
