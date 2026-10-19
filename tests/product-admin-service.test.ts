import { describe, expect, it } from "vitest"

import {
  DEFAULT_PRODUCT_UNIT,
  ProductValidationError,
  normalizeProductUnit,
  productValidationErrorResponse,
} from "../lib/product-admin-service.js"

describe("product admin validation", () => {
  it("returns structured validation errors", async () => {
    const response = productValidationErrorResponse(
      new ProductValidationError({ reviewNote: "Rejection note is required" })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      details: { reviewNote: "Rejection note is required" },
      error: "VALIDATION_ERROR",
    })
  })

  it("normalizes blank product units to the public catalog default", () => {
    expect(normalizeProductUnit("")).toBe(DEFAULT_PRODUCT_UNIT)
    expect(normalizeProductUnit("  ")).toBe(DEFAULT_PRODUCT_UNIT)
    expect(normalizeProductUnit("台")).toBe("台")
  })
})
