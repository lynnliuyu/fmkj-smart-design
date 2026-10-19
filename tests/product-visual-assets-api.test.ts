import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock("@/lib/admin-auth", async () => ({ ...await import("../lib/admin-auth"), requireSuperAdmin: mocks.requireAdmin }))
vi.mock("@/lib/admin-api", () => import("../lib/admin-api"))
vi.mock("@/lib/product-visual-assets", () => import("../lib/product-visual-assets"))
vi.mock("@/lib/product-visual-assets-service", () => ({ getAdminProductVisualAsset: mocks.get, saveAdminProductVisualAsset: mocks.save }))
import { AdminAuthError } from "../lib/admin-auth"
import { ProductVisualValidationError } from "../lib/product-visual-assets"
import { GET, PATCH } from "../app/api/admin/products/[id]/visual/route"

const id = "20000000-0000-0000-0000-000000000001"
const context = () => ({ params: Promise.resolve({ id }) })
const request = (body = "{}") => new NextRequest(`http://localhost/api/admin/products/${id}/visual`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })

beforeEach(() => {
  mocks.requireAdmin.mockReset().mockResolvedValue({ user: { userId: id } })
  mocks.get.mockReset(); mocks.save.mockReset()
})

describe("independent admin product visual API", () => {
  it.each(["UNAUTHORIZED", "PLATFORM_ADMIN_REQUIRED"] as const)("protects both methods against %s without reading or writing product images", async (code) => {
    mocks.requireAdmin.mockRejectedValue(new AdminAuthError(code))
    expect((await GET(request(), context())).status).toBe(code === "UNAUTHORIZED" ? 401 : 403)
    expect((await PATCH(request(), context())).status).toBe(code === "UNAUTHORIZED" ? 401 : 403)
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
  })

  it("returns original and display image identities separately", async () => {
    const payload = { productId: id, originalImage: "/original.png", visual: { image: "/clean.png", revision: 2 } }
    mocks.get.mockResolvedValue(payload)
    await expect((await GET(request(), context())).json()).resolves.toEqual(payload)
  })

  it("only uses the authenticated actor when saving", async () => {
    const body = { image: "/clean.png", expectedRevision: 2 }
    mocks.save.mockResolvedValue({ productId: id })
    expect((await PATCH(request(JSON.stringify(body)), context())).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith({ productId: id, actorUserId: id, mutation: body })
  })

  it("returns a refreshable 409 for a stale visual revision", async () => {
    mocks.save.mockRejectedValue(new ProductVisualValidationError({ expectedRevision: "请刷新" }, 409))
    const response = await PATCH(request(), context())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ details: { expectedRevision: "请刷新" } })
  })

  it("reports malformed JSON without entering the save service", async () => {
    expect((await PATCH(request("{"), context())).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
