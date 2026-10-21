import { describe, expect, it } from "vitest"
import { defaultProductVisualAsset, parseProductVisualAssetMutation, ProductVisualValidationError, validProductVisualImage } from "../lib/product-visual-assets"

const input = { image: "/placeholder.svg", sourceImage: "https://example.com/original.png", crop: null, scale: 1, reviewStatus: "pending", expectedRevision: 0, evidence: "" }

describe("reusable product display image contract", () => {
  it("keeps old product images usable without asserting an exact model", () => {
    expect(defaultProductVisualAsset("/assets/old.png", "2026-10-15")).toEqual({ image: "/assets/old.png", sourceImage: "/assets/old.png", crop: null, scale: 1, reviewStatus: "pending", revision: 0, updatedAt: "2026-10-15", evidence: "" })
    expect(parseProductVisualAssetMutation(input)).toEqual(input)
  })

  it("accepts normalized crops, presentation size and independently reviewed evidence", () => {
    const result = parseProductVisualAssetMutation({ ...input, crop: { x: 0.2, y: 0.1, width: 0.7, height: 0.8 }, scale: 1.25, reviewStatus: "verified", evidence: "  官方型号页 https://example.com/sku  ", expectedRevision: 3 })
    expect(result.evidence).toBe("官方型号页 https://example.com/sku")
    expect(result.crop).toEqual({ x: 0.2, y: 0.1, width: 0.7, height: 0.8 })
    expect(result.expectedRevision).toBe(3)
  })

  it.each([
    { x: -0.1, y: 0, width: 1, height: 1 }, { x: 0.3, y: 0, width: 0.8, height: 1 },
    { x: 0, y: 0.6, width: 1, height: 0.5 }, { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: Number.NaN, height: 1 }, { x: 0, y: 0, width: 1, height: 1, right: 0 },
  ])("rejects invalid or out of image crop %j", (crop) => {
    expect(() => parseProductVisualAssetMutation({ ...input, crop })).toThrow(ProductVisualValidationError)
  })

  it.each(["javascript:alert(1)", "data:image/png;base64,a", "blob:https://example.com/1", "//example.com/a.png", "/assets/../private.png", "/assets/%2e%2e/private.png", "https://user:password@example.com/a.png", "/assets/evil\\image.png"]) ("rejects unsafe image source %s", (image) => {
    expect(validProductVisualImage(image)).toBe(false)
    expect(() => parseProductVisualAssetMutation({ ...input, image })).toThrow(ProductVisualValidationError)
  })

  it("rejects incomplete metadata, missing concurrency version and incidental price writes", () => {
    for (const patch of [{ scale: 2.1 }, { expectedRevision: undefined }, { expectedRevision: 1.5 }, { reviewStatus: "verified", evidence: " " }, { sourceImage: "" }, { price: 0 }]) {
      expect(() => parseProductVisualAssetMutation({ ...input, ...patch })).toThrow(ProductVisualValidationError)
    }
  })
})
