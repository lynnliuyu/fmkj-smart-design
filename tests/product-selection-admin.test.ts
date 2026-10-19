import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }))
vi.mock("../lib/server-db", () => ({ getPool: () => ({ connect: database.connect, query: database.query }) }))

import {
  createAdminProduct,
  mapProduct,
  prepareProductSelection,
  productSelectionMutationFields,
  updateAdminProduct,
  type ProductRow,
} from "../lib/product-admin-service"

const row: ProductRow = {
  id: "20000000-0000-0000-0000-000000000001", name: "已核三键开关", sku: "THREE-KEY", category: "开关", brand: "合成", platform: "测试",
  unit: "个", price: 90, cost: 50, stock: 10, image: null, description: "原规格", tags: [], channels: [], status: "active",
  created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z", submitted_by: null, reviewed_by: null, reviewed_at: null, review_note: null,
  catalog_kind: "sku", device_type_id: "wall-switch", parent_product_id: null, manufacturer_model: "TEST-3",
  specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: ["zigbee"], capabilities: ["load-control"],
  selection_status: "verified", selection_evidence: "合成规格测试依据", pricing_status: "verified", pricing_evidence: "合成价格依据", mapping_revision: 4,
}
const before = () => mapProduct(row)
const input = () => ({ name: row.name, sku: row.sku, brand: row.brand, platform: row.platform, category: row.category, price: 90, cost: 50, unit: "个" })

beforeEach(() => {
  database.query.mockReset()
  database.release.mockReset()
  database.connect.mockResolvedValue(database)
})

describe("product selection administration", () => {
  it("preserves reviewed selection fields in an ordinary catalog edit", () => {
    const next = prepareProductSelection({ ...input(), name: "更清晰的产品名称" }, before())
    expect(next.specs).toEqual({ button_count: 3, relay_count: 2, wiring: "neutral" })
    expect(next.selectionStatus).toBe("verified")
    expect(next.pricingStatus).toBe("verified")
    expect(next.mappingRevision).toBe(4)
    expect(productSelectionMutationFields({ name: "普通编辑" })).toEqual({})
  })

  it("reopens verification and increments revision when reviewed specs change", () => {
    const next = prepareProductSelection({ ...input(), ...before(), specs: { button_count: 4, relay_count: 2, wiring: "neutral" } }, before())
    expect(next.selectionStatus).toBe("pending")
    expect(next.pricingStatus).toBe("pending")
    expect(next.mappingRevision).toBe(5)
  })

  it("requires evidence and required structured specs for verified SKU", () => {
    expect(() => prepareProductSelection({ ...input(), catalogKind: "sku", deviceTypeId: "wall-switch", selectionStatus: "verified" })).toThrow("VALIDATION_ERROR")
    expect(() => prepareProductSelection({ ...input(), catalogKind: "sku", deviceTypeId: "wall-switch", selectionStatus: "pending", specs: { button_count: "三键" } as never })).toThrow()
    expect(() => prepareProductSelection({ ...input(), pricingStatus: "verified" })).toThrow("VALIDATION_ERROR")
  })

  it("keeps known zero prices distinct from unknown prices", () => {
    const next = prepareProductSelection({ ...input(), price: 0, pricingStatus: "verified", pricingEvidence: "合成零价赠品核价" })
    expect(next.pricingStatus).toBe("verified")
  })

  it("protects legacy rows with pending defaults without changing identity", () => {
    const legacy = mapProduct({ ...row, catalog_kind: undefined, device_type_id: undefined, specs: undefined, protocols: undefined, capabilities: undefined, selection_status: undefined, selection_evidence: undefined, pricing_status: undefined, pricing_evidence: undefined, mapping_revision: undefined })
    expect(legacy.id).toBe(row.id)
    expect(legacy.catalogKind).toBe("legacy")
    expect(legacy.selectionStatus).toBe("pending")
    expect(legacy.specs).toEqual({})
  })

  it("freezes old quote display before updating product in one transaction", async () => {
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes("for update") && sql.includes("select")) return { rows: sql.includes("parent_product_id=$1") ? [] : [row] }
      if (sql.includes("update products set")) return { rows: [row] }
      return { rows: [] }
    })
    await updateAdminProduct({ ...input(), actorUserId: "10000000-0000-0000-0000-000000000001", productId: row.id, mappingRevision: 4 })
    const queries = database.query.mock.calls.map((call) => String(call[0]))
    expect(queries[0]).toBe("begin")
    expect(queries.findIndex((sql) => sql.includes("update quote_items"))).toBeLessThan(queries.findIndex((sql) => sql.includes("update products set")))
    expect(queries.at(-1)).toBe("commit")
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("rolls back without editing a product when quote protection fails", async () => {
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes("for update")) return { rows: sql.includes("parent_product_id=$1") ? [] : [row] }
      if (sql.includes("update quote_items")) throw new Error("snapshot unavailable")
      return { rows: [] }
    })
    await expect(updateAdminProduct({ ...input(), actorUserId: "10000000-0000-0000-0000-000000000001", productId: row.id })).rejects.toThrow("snapshot unavailable")
    expect(database.query.mock.calls.some((call) => String(call[0]).includes("update products set"))).toBe(false)
    expect(database.query).toHaveBeenLastCalledWith("rollback")
    expect(database.release).toHaveBeenCalledOnce()
  })

  it("rejects stale editing revisions before any product or snapshot update", async () => {
    database.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("for update") ? [row] : [] }))
    await expect(updateAdminProduct({ ...input(), actorUserId: "10000000-0000-0000-0000-000000000001", productId: row.id, mappingRevision: 3 })).rejects.toThrow("VALIDATION_ERROR")
    expect(database.query.mock.calls.some((call) => String(call[0]).includes("update quote_items"))).toBe(false)
  })

  it("creates a legacy row with pending defaults and SQL-safe empty evidence", async () => {
    database.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("insert into products") ? [{ ...row, catalog_kind: "legacy", device_type_id: null, specs: {}, protocols: [], capabilities: [], selection_status: "pending", selection_evidence: "", pricing_status: "pending", pricing_evidence: "", mapping_revision: 1 }] : [] }))
    const product = await createAdminProduct({ ...input(), actorUserId: "10000000-0000-0000-0000-000000000001" })
    expect(product.catalogKind).toBe("legacy")
    expect(product.selectionStatus).toBe("pending")
    const inserted = database.query.mock.calls.find((call) => String(call[0]).includes("insert into products"))!
    expect(inserted[1][23]).toBe("")
    expect(inserted[1][25]).toBe("")
    expect(database.query).toHaveBeenLastCalledWith("commit")
  })

  it("does not invalidate mapping when equivalent spec keys and protocol sets reorder", () => {
    const next = prepareProductSelection({ ...input(), specs: { wiring: "neutral", relay_count: 2, button_count: 3 }, protocols: ["zigbee"] }, before())
    expect(next.mappingRevision).toBe(4)
    expect(next.selectionStatus).toBe("verified")
  })

  it("rejects a SKU whose parent is not a series", async () => {
    database.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("with recursive") ? [{ id: "20000000-0000-0000-0000-000000000002", catalog_kind: "sku", device_type_id: "wall-switch", cycle: false }] : [] }))
    await expect(createAdminProduct({ ...input(), actorUserId: "10000000-0000-0000-0000-000000000001", catalogKind: "sku", deviceTypeId: "wall-switch", parentProductId: "20000000-0000-0000-0000-000000000002" })).rejects.toThrow("VALIDATION_ERROR")
    expect(database.query.mock.calls.some((call) => String(call[0]).includes("insert into products"))).toBe(false)
  })
})
