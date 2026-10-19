import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), requireAdmin: vi.fn() }))
vi.mock("../lib/server-db", () => ({ getPool: () => ({ connect: database.connect, query: database.query }) }))
vi.mock("@/lib/admin-auth", async () => ({ ...await import("../lib/admin-auth"), requireSuperAdmin: database.requireAdmin }))
vi.mock("@/lib/admin-api", () => import("../lib/admin-api"))
vi.mock("@/lib/product-admin-service", () => import("../lib/product-admin-service"))

import { AdminAuthError } from "../lib/admin-auth"
import { POST } from "../app/api/admin/products/bulk-review/route"
import {
  bulkReviewAdminProducts,
  mapProduct,
  MAX_BULK_PRODUCT_REVIEW,
  parseBulkProductReviewInput,
  ProductValidationError,
  type ProductRow,
} from "../lib/product-admin-service"

const actor = "10000000-0000-0000-0000-000000000001"
const firstId = "20000000-0000-0000-0000-000000000001"
const secondId = "20000000-0000-0000-0000-000000000002"
const absentId = "20000000-0000-0000-0000-000000000003"
const base: ProductRow = {
  id: firstId, name: "合成待审产品", sku: "TEST-REVIEW", category: "开关", brand: "合成", platform: "测试",
  unit: "个", price: 120, cost: 71.5, stock: 10, image: null, description: "原资料", tags: ["原标签"], channels: ["原渠道"], status: "pending_review",
  created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z", submitted_by: null, reviewed_by: null, reviewed_at: null, review_note: null,
  catalog_kind: "sku", device_type_id: "wall-switch", parent_product_id: null, manufacturer_model: "TEST-3",
  specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: ["zigbee"], capabilities: ["load-control"],
  selection_status: "pending", selection_evidence: "参数仍待核对", pricing_status: "conflict", pricing_evidence: "价格来源冲突", mapping_revision: 4,
}
let rows: ProductRow[]
let staged: ProductRow[]
let stagedFreezes: string[]
let freezes: string[]
let failAudit: boolean
const target = (id = firstId, mappingRevision = 4) => ({ id, mappingRevision })
const request = (body: unknown) => new NextRequest("http://localhost/api/admin/products/bulk-review", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
})

beforeEach(() => {
  rows = [structuredClone(base), { ...structuredClone(base), id: secondId, sku: "TEST-REVIEW-2" }]
  staged = []
  stagedFreezes = []
  freezes = []
  failAudit = false
  database.query.mockReset()
  database.release.mockReset()
  database.connect.mockReset().mockResolvedValue(database)
  database.requireAdmin.mockReset().mockResolvedValue({ user: { userId: actor } })
  database.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql === "begin") { staged = structuredClone(rows); stagedFreezes = []; return { rows: [] } }
    if (sql === "commit") { rows = structuredClone(staged); freezes = [...stagedFreezes]; return { rows: [] } }
    if (sql === "rollback") { staged = []; stagedFreezes = []; return { rows: [] } }
    if (sql.includes("for update")) return { rows: staged.filter((row) => (params[0] as string[]).includes(row.id)) }
    if (sql.includes("update quote_items")) { stagedFreezes.push(String(params[0])); return { rows: [] } }
    if (sql.includes("update products set")) {
      const row = staged.find((product) => product.id === params[0])!
      Object.assign(row, { status: "approved", reviewed_by: params[1], review_note: params[2] || null,
        reviewed_at: "2026-10-14T01:00:00Z", updated_at: "2026-10-14T01:00:00Z", mapping_revision: Number(row.mapping_revision) + 1 })
      return { rows: [structuredClone(row)] }
    }
    if (sql.includes("insert into activity_logs") && failAudit) throw new Error("audit unavailable")
    return { rows: [] }
  })
})

describe("bulk product review input", () => {
  it("normalizes UUIDs, deduplicates repeated rows and fixes lock order", () => {
    const upperId = "AAAAAAAA-0000-0000-0000-000000000001"
    const parsed = parseBulkProductReviewInput({ products: [target(upperId), target(secondId), target(firstId), target(firstId)], note: "  已看过目录资料  " })
    expect(parsed).toEqual({ products: [target(firstId), target(secondId), target(upperId.toLowerCase())], note: "已看过目录资料" })
  })

  it.each([null, {}, { products: [] }, { products: ["invalid"] }, { products: [{ id: "bad", mappingRevision: 4 }] },
    { products: [target(firstId, 0)] }, { products: [target(firstId, 1.5)] }, { products: [{ id: firstId, mappingRevision: "4" }] },
    { products: [target(firstId, Number.MAX_SAFE_INTEGER + 1)] }, { products: [target(firstId), target(firstId, 5)] },
    { products: Array.from({ length: MAX_BULK_PRODUCT_REVIEW + 1 }, () => target()) },
    { products: [target()], note: 12 }, { products: [target()], note: "x".repeat(1001) },
  ])("rejects invalid or unbounded input before a database connection", async (input) => {
    expect(() => parseBulkProductReviewInput(input)).toThrow(ProductValidationError)
    expect(database.connect).not.toHaveBeenCalled()
  })
})

describe("bulk product catalog approval", () => {
  it("locks the complete explicit list in ID order, freezes history and records each approval in one transaction", async () => {
    const result = await bulkReviewAdminProducts({ actorUserId: actor, products: [target(secondId), target(firstId), target(firstId)], note: "目录资料已审" })
    expect(result).toMatchObject({ approved: 2, skipped: 0, skippedProducts: [] })
    expect(result.products.map((product) => product.id)).toEqual([firstId, secondId])
    expect(result.products.every((product) => product.status === "approved" && product.mappingRevision === 5 && product.reviewedBy === actor)).toBe(true)
    expect(freezes).toEqual([firstId, secondId])
    const queries = database.query.mock.calls.map(([sql]) => String(sql))
    expect(queries[0]).toBe("begin")
    expect(queries[1]).toContain("order by id for update")
    expect(database.query.mock.calls[1][1]).toEqual([[firstId, secondId]])
    expect(queries.filter((sql) => sql.includes("insert into activity_logs"))).toHaveLength(2)
    expect(queries.findIndex((sql) => sql.includes("update quote_items"))).toBeLessThan(queries.findIndex((sql) => sql.includes("update products set")))
    expect(queries.at(-1)).toBe("commit")
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("never approves selection or pricing, changes prices or overwrites product evidence/data", async () => {
    const original = mapProduct(base)
    const { products: [product] } = await bulkReviewAdminProducts({ actorUserId: actor, products: [target()] })
    for (const key of ["selectionStatus", "selectionEvidence", "pricingStatus", "pricingEvidence", "price", "cost", "specs", "protocols", "capabilities", "name", "sku", "image", "unit", "catalogKind", "deviceTypeId"] as const) {
      expect(product[key]).toEqual(original[key])
    }
    const update = String(database.query.mock.calls.find(([sql]) => String(sql).includes("update products set"))![0]).split("returning")[0]
    expect(update).not.toMatch(/selection_status|selection_evidence|pricing_status|pricing_evidence|\bprice\s*=|\bcost\s*=|\bspecs\s*=/)
  })

  it("skips already approved/active rows without a second revision, history write or log", async () => {
    rows[0].status = "approved"
    rows[0].mapping_revision = 5
    rows[1].status = "active"
    rows[1].mapping_revision = 8
    const result = await bulkReviewAdminProducts({ actorUserId: actor, products: [target(), target(secondId)] })
    expect(result).toMatchObject({ approved: 0, skipped: 2, products: [], skippedProducts: [
      { id: firstId, status: "approved", reason: "already-approved" }, { id: secondId, status: "active", reason: "already-approved" },
    ] })
    expect(rows.map((row) => row.mapping_revision)).toEqual([5, 8])
    expect(database.query.mock.calls.some(([sql]) => /update quote_items|update products|insert into activity_logs/.test(String(sql)))).toBe(false)
  })

  it.each(["rejected", "inactive"] as const)("does not restore %s products or partly approve the batch", async (status) => {
    rows[1].status = status
    await expect(bulkReviewAdminProducts({ actorUserId: actor, products: [target(), target(secondId)] })).rejects.toThrow(ProductValidationError)
    expect(rows.map((row) => row.status)).toEqual(["pending_review", status])
    expect(database.query.mock.calls.some(([sql]) => /update quote_items|update products/.test(String(sql)))).toBe(false)
    expect(database.query).toHaveBeenLastCalledWith("rollback")
  })

  it("rolls back the whole batch before writes if any pending product revision is stale", async () => {
    rows[1].mapping_revision = 5
    await expect(bulkReviewAdminProducts({ actorUserId: actor, products: [target(), target(secondId)] })).rejects.toMatchObject({ details: { [`products.${secondId}`]: expect.stringContaining("已被更新") } })
    expect(rows.map((row) => row.status)).toEqual(["pending_review", "pending_review"])
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes("update" ) && !String(sql).includes("for update"))).toBe(false)
    expect(database.query).toHaveBeenLastCalledWith("rollback")
  })

  it("rejects nonexistent/deleted IDs rather than approving the remaining subset", async () => {
    await expect(bulkReviewAdminProducts({ actorUserId: actor, products: [target(), target(absentId)] })).rejects.toMatchObject({ details: { [`products.${absentId}`]: expect.stringContaining("不存在") } })
    expect(rows[0].status).toBe("pending_review")
    expect(freezes).toEqual([])
  })

  it("rolls back approvals and frozen history when audit recording fails", async () => {
    failAudit = true
    await expect(bulkReviewAdminProducts({ actorUserId: actor, products: [target(), target(secondId)] })).rejects.toThrow("audit unavailable")
    expect(rows.every((row) => row.status === "pending_review" && row.mapping_revision === 4)).toBe(true)
    expect(freezes).toEqual([])
    expect(database.query).toHaveBeenLastCalledWith("rollback")
    expect(database.release).toHaveBeenCalledOnce()
  })
})

describe("bulk review API authorization and contract", () => {
  it.each([["UNAUTHORIZED", 401], ["PLATFORM_ADMIN_REQUIRED", 403]] as const)("rejects %s before reading or writing products", async (code, status) => {
    database.requireAdmin.mockRejectedValue(new AdminAuthError(code))
    const response = await POST(request({ products: [target()] }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: code })
    expect(database.connect).not.toHaveBeenCalled()
  })

  it("takes the audit actor from authentication and ignores a spoofed body actor or verified flags", async () => {
    const response = await POST(request({ products: [target()], actorUserId: absentId, selectionStatus: "verified", pricingStatus: "verified" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ approved: 1, skipped: 0, products: [{ reviewedBy: actor, selectionStatus: "pending", pricingStatus: "conflict" }] })
    const update = database.query.mock.calls.find(([sql]) => String(sql).includes("update products set"))!
    expect(update[1][1]).toBe(actor)
  })

  it("returns a field-level 400 for a stale batch with no partial approval", async () => {
    const response = await POST(request({ products: [target(), target(secondId, 3)] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR", details: { [`products.${secondId}`]: expect.any(String) } })
    expect(rows.every((row) => row.status === "pending_review")).toBe(true)
  })

  it("rejects malformed JSON and an oversized body without opening a transaction", async () => {
    for (const body of ["{broken", JSON.stringify({ products: [target()], padding: "x".repeat(64 * 1024) })]) {
      const response = await POST(new NextRequest("http://localhost/api/admin/products/bulk-review", { method: "POST", body }))
      expect(response.status).toBe(400)
    }
    expect(database.connect).not.toHaveBeenCalled()
  })
})
