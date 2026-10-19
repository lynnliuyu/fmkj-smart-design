import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const api = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn() }))
const auth = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }))
vi.mock("@/lib/server-db", () => ({ hasDatabaseUrl: () => true, getPool: () => ({ query: api.query }) }))
vi.mock("@/lib/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/admin-auth")>()
  return { ...actual, requireSuperAdmin: auth.requireSuperAdmin }
})
vi.mock("@/lib/product-admin-service", () => ({
  createAdminProduct: api.create,
  productSelectionMutationFields: (body: Record<string, unknown>) => Object.fromEntries(["catalogKind", "deviceTypeId", "specs", "selectionStatus", "selectionEvidence", "pricingStatus", "pricingEvidence"].filter((key) => key in body).map((key) => [key, body[key]])),
  productValidationErrorResponse: (error: unknown) => { throw error },
}))
vi.mock("@/lib/fallback-products", () => ({ fallbackProducts: [] }))
vi.mock("@/lib/product-categories", async () => await import("../lib/product-categories"))
vi.mock("@/lib/product-selection", async () => await import("../lib/product-selection"))
vi.mock("@/lib/product-visual-assets-service", () => ({ loadProductVisualAssets: async () => new Map() }))
import { AdminAuthError } from "../lib/admin-auth"
import { GET, POST } from "../app/api/products/route"

const adminUser = { user: { userId: "30000000-0000-0000-0000-000000000009" } }

const product = {
  id: "20000000-0000-0000-0000-000000000001", name: "合成三键", sku: "TEST-THREE", category: "开关", unit: "个", price: 0,
  status: "active", catalogKind: "sku", deviceTypeId: "wall-switch", specs: { button_count: 3, relay_count: 2, wiring: "neutral" },
  protocols: ["zigbee"], capabilities: ["load-control"], selectionStatus: "pending", pricingStatus: "pending", mappingRevision: 7,
}

beforeEach(() => { api.create.mockReset(); api.query.mockReset(); auth.requireSuperAdmin.mockReset() })

describe("product API selection contract", () => {
  it("returns structured selection metadata without dropping arrays or revision", async () => {
    api.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("count(*)") ? [{ count: 1 }] : [product], rowCount: 1 }))
    const response = await GET()
    const payload = await response.json()
    expect(payload.source).toBe("postgres")
    expect(payload.data[0]).toMatchObject(product)
    expect(payload.data[0].parentProductId).toBeNull()
  })

  it("rejects a product copy from a non-super-admin caller", async () => {
    auth.requireSuperAdmin.mockRejectedValue(new AdminAuthError("PLATFORM_ADMIN_REQUIRED"))
    const response = await POST(new NextRequest("http://localhost/api/products", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...product }),
    }))
    expect(response.status).toBe(403)
    expect(api.create).not.toHaveBeenCalled()
  })

  it("does not let a super-admin product copy claim verified metadata", async () => {
    auth.requireSuperAdmin.mockResolvedValue(adminUser)
    api.create.mockResolvedValue(product)
    const response = await POST(new NextRequest("http://localhost/api/products", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...product, selectionStatus: "verified", pricingStatus: "verified", selectionEvidence: "伪造", pricingEvidence: "伪造" }),
    }))
    expect(response.status).toBe(201)
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: adminUser.user.userId, catalogKind: "sku", selectionStatus: "pending", pricingStatus: "pending", specs: product.specs }))
  })
})
