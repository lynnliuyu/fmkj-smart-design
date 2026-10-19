import { describe, expect, it } from "vitest"

import { adminApiErrorResponse } from "../lib/admin-api.js"
import { AdminAuthError } from "../lib/admin-auth.js"
import { PlatformValidationError } from "../lib/account-system/platform-admin-service.js"
import { ProductValidationError } from "../lib/product-admin-service.js"

describe("admin API error responses", () => {
  it("returns 401 for missing sessions", async () => {
    const response = adminApiErrorResponse(new AdminAuthError("UNAUTHORIZED"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" })
  })

  it("returns 403 for non-super-admin sessions", async () => {
    const response = adminApiErrorResponse(new AdminAuthError("PLATFORM_ADMIN_REQUIRED"))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "PLATFORM_ADMIN_REQUIRED" })
  })

  it("returns 400 VALIDATION_ERROR payloads", async () => {
    const response = adminApiErrorResponse(new PlatformValidationError({ email: "Valid email is required" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      details: { email: "Valid email is required" },
      error: "VALIDATION_ERROR",
    })
  })

  it("returns product validation errors through the shared admin handler", async () => {
    const response = adminApiErrorResponse(new ProductValidationError({ sku: "SKU is required" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      details: { sku: "SKU is required" },
      error: "VALIDATION_ERROR",
    })
  })
})
