import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock("../lib/server-db", () => ({ getPool: () => ({ query: mocks.query, connect: mocks.connect }) }))
import { getAdminProductVisualAsset, loadProductVisualAssets, saveAdminProductVisualAsset } from "../lib/product-visual-assets-service"

const id = "20000000-0000-0000-0000-000000000001"
const product = { id, name: "三键开关", image: "/assets/original.png", updated_at: new Date("2026-10-15T00:00:00Z") }
const row = { product_id: id, image: "/assets/clean.png", source_image: product.image, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, scale: "1.25", review_status: "series", evidence: "厂家系列图", revision: 2, updated_at: new Date("2026-10-15T01:00:00Z") }
const mutation = { image: row.image, sourceImage: row.source_image, crop: row.crop, scale: 1.25, reviewStatus: row.review_status, evidence: row.evidence, expectedRevision: 1 }

beforeEach(() => {
  mocks.query.mockReset(); mocks.connect.mockReset(); mocks.release.mockReset()
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
})

describe("product visual library persistence", () => {
  it("loads only requested display derivatives and leaves missing products for the caller's fallback", async () => {
    mocks.query.mockResolvedValue({ rows: [row] })
    const result = await loadProductVisualAssets({ query: mocks.query }, [id, id, "legacy-demo"])
    expect(mocks.query.mock.calls[0][1]).toEqual([[id]])
    expect(result.get(id)).toMatchObject({ image: row.image, scale: 1.25, revision: 2, updatedAt: "2026-10-15T01:00:00.000Z" })
    mocks.query.mockClear()
    expect((await loadProductVisualAssets({ query: mocks.query }, [])).size).toBe(0)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it("serves the unmodified product image before a visual library record exists", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [product] }).mockResolvedValueOnce({ rows: [] })
    const result = await getAdminProductVisualAsset(id)
    expect(result).toMatchObject({ productId: id, originalImage: product.image, visual: { image: product.image, sourceImage: product.image, revision: 0, reviewStatus: "pending" } })
  })

  it("saves a separate derivative and activity atomically without touching products, quote prices or snapshots", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select id::text")) return { rows: [product] }
      if (sql.startsWith("select * from product_visual_assets")) return { rows: [{ ...row, revision: 1 }] }
      if (sql.includes("insert into product_visual_assets")) return { rows: [row] }
      return { rows: [] }
    })
    const result = await saveAdminProductVisualAsset({ productId: id, actorUserId: id, mutation })
    expect(result.visual.revision).toBe(2)
    const sql = mocks.query.mock.calls.map(([statement]) => statement as string)
    expect(sql[0]).toBe("begin")
    expect(sql[1]).toContain("for update")
    expect(sql.some((statement) => /update\s+products\s+set|quote_items|quotes\s+set/i.test(statement))).toBe(false)
    expect(sql.some((statement) => statement.includes("product.visual_updated"))).toBe(true)
    expect(sql.at(-1)).toBe("commit")
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("rejects stale first-write and existing revisions rather than silently overwriting", async () => {
    for (const existing of [[], [{ ...row, revision: 2 }]]) {
      mocks.query.mockReset()
      mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select id::text") ? [product] : sql.startsWith("select * from product_visual_assets") ? existing : [] }))
      await expect(saveAdminProductVisualAsset({ productId: id, actorUserId: id, mutation })).rejects.toMatchObject({ status: 409, details: { expectedRevision: expect.any(String) } })
      expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("insert into product_visual_assets"))).toBe(false)
      expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback")
    }
  })

  it("rolls back the derivative if writing the audit fails", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select id::text")) return { rows: [product] }
      if (sql.startsWith("select * from product_visual_assets")) return { rows: [{ ...row, revision: 1 }] }
      if (sql.includes("insert into product_visual_assets")) return { rows: [row] }
      if (sql.includes("insert into activity_logs")) throw new Error("audit failed")
      return { rows: [] }
    })
    await expect(saveAdminProductVisualAsset({ productId: id, actorUserId: id, mutation })).rejects.toThrow("audit failed")
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback")
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})
