import { describe, expect, it } from "vitest"
import { buildAccountContext, type AccountContext } from "../lib/account-context"
import { refreshQuoteImages } from "../lib/quote-image-refresh"

const PROJECT = "11111111-1111-4111-8111-111111111111"
const USER = "22222222-2222-4222-8222-222222222222"
const QUOTE = "33333333-3333-4333-8333-333333333333"
const HISTORY = "44444444-4444-4444-8444-444444444444"
const SWITCH = "55555555-5555-4555-8555-555555555555"
const CURTAIN = "66666666-6666-4666-8666-666666666666"
const AP = "77777777-7777-4777-8777-777777777777"
const OLD_TIME = "2026-10-15T01:00:00.000Z"
const NEW_TIME = "2026-10-15T02:00:00.000Z"
const input = { projectId: PROJECT, quoteId: QUOTE, expectedUpdatedAt: OLD_TIME }
const visual = { image: "/assets/clean-switch.png", source_image: "/assets/original-switch.png", crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, scale: "1.3", review_status: "series", revision: 4, evidence: "系列图待换精确型号", updated_at: NEW_TIME, product_id: SWITCH }
type Item = { id: string; quoteId: string; productId: string; deleted: boolean; name: string; note: string; room: string; quantity: number; price: number; cost: number; snapshot: Record<string, unknown> | null }
type Quote = { id: string; status: string; updatedAt: string; total: number; installationFee: number; discount: number }

function account(enterprise = false): AccountContext {
  return buildAccountContext({ userId: USER, name: "Synthetic", role: "pro" }, { id: USER, role: "pro", account_type: enterprise ? "ENTERPRISE_MEMBER" : "PERSONAL_PRO", account_status: "active" }, enterprise ? { id: HISTORY, name: "Synthetic team", role: "editor" } : null)
}

/** Model row scoping and rollback, rather than returning success for every UPDATE. */
class RefreshDatabase {
  calls: Array<{ sql: string; params: unknown[] }> = []
  connections = 0
  released = false
  quotes: Quote[] = [
    { id: QUOTE, status: "draft", updatedAt: OLD_TIME, total: 1234, installationFee: 300, discount: 90 },
    { id: HISTORY, status: "sent", updatedAt: OLD_TIME, total: 999, installationFee: 200, discount: 85 },
  ]
  items: Item[] = [
    { id: "living", quoteId: QUOTE, productId: SWITCH, deleted: false, name: "客厅三开", note: "客厅备注", room: "客厅", quantity: 2, price: 150, cost: 60, snapshot: { name: "客厅三开", spec: "客厅专用说明", image: "/old-switch.png", custom: { retained: true } } },
    { id: "dining", quoteId: QUOTE, productId: SWITCH, deleted: false, name: "餐厅三开", note: "餐厅备注", room: "餐厅", quantity: 1, price: 145, cost: 60, snapshot: { name: "餐厅三开", spec: "餐厅专用说明", image: "/old-switch.png" } },
    { id: "curtain", quoteId: QUOTE, productId: CURTAIN, deleted: false, name: "窗帘", note: "量尺待复核", room: "主卧", quantity: 5.5, price: 100, cost: 30, snapshot: { image: "/keep-curtain.png", visualAsset: { image: "/keep-curtain.png", revision: 1 }, name: "历史窗帘规格" } },
    { id: "legacy", quoteId: QUOTE, productId: AP, deleted: false, name: "原报价AP", note: "原报价规格", room: "走廊", quantity: 1, price: 350, cost: 200, snapshot: null },
    { id: "historical", quoteId: HISTORY, productId: SWITCH, deleted: false, name: "已交付开关", note: "历史说明", room: "客厅", quantity: 3, price: 125, cost: 50, snapshot: { name: "历史型号", image: "/historic-photo.png" } },
    { id: "deleted", quoteId: QUOTE, productId: SWITCH, deleted: true, name: "已移除行", note: "删除前备注", room: "客厅", quantity: 20, price: 100, cost: 45, snapshot: null },
  ]
  products = [
    { id: SWITCH, image: "/assets/catalog-switch.png", name: "库中开关新名", sku: "SW-3", description: "新描述", category: "开关", unit: "个" },
    { id: CURTAIN, image: "/placeholder.svg", name: "窗帘", sku: "CU", description: "", category: "窗帘", unit: "米" },
    { id: AP, image: "/assets/ap.png", name: "库中AP", sku: "AP", description: "新AP描述", category: "网络", unit: "个" },
  ]
  visuals = [structuredClone(visual)]
  private backup: { quotes: Quote[]; items: Item[] } | null = null

  constructor(readonly options: { visible?: boolean; accessLevel?: string; failAt?: "image" | "audit" } = {}) {}
  async connect() { this.connections++; return this }
  release() { this.released = true }
  async query<T>(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params })
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()
    let rows: unknown[] = []
    if (normalized === "begin") this.backup = structuredClone({ quotes: this.quotes, items: this.items })
    else if (normalized === "rollback") { if (this.backup) Object.assign(this, this.backup); this.backup = null }
    else if (normalized === "commit") this.backup = null
    else if (normalized.includes("from projects p")) rows = this.options.visible === false ? [] : [{ createdBy: this.options.accessLevel ? HISTORY : USER, accessLevel: this.options.accessLevel ?? null }]
    else if (normalized.includes("from quotes")) rows = this.quotes.filter((quote) => quote.status === "draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 1).map(({ id, updatedAt }) => ({ id, updatedAt }))
    else if (normalized.startsWith("select distinct p.id")) rows = this.products.filter((product) => this.items.some((item) => item.quoteId === params[0] && item.productId === product.id && !item.deleted)).map(({ id, image }) => ({ id, image }))
    else if (normalized.includes("from product_visual_assets v")) rows = this.visuals.filter((asset) => (params[0] as string[]).includes(asset.product_id))
    else if (normalized.startsWith("update quote_items qi set product_snapshot=jsonb_build_object")) {
      for (const item of this.items) {
        if (item.quoteId !== params[0] || item.productId !== params[1] || item.snapshot || (normalized.includes("qi.deleted_at is null") && item.deleted)) continue
        const product = this.products.find((candidate) => candidate.id === item.productId)!
        item.snapshot = { version: 1, origin: "quote-image-refresh", name: item.name || product.name, sku: product.sku, spec: item.note || product.description || product.sku, unit: product.unit, category: product.category, image: product.image }
      }
    } else if (normalized.startsWith("update quote_items set product_snapshot=jsonb_set")) {
      if (this.options.failAt === "image") throw new Error("image update failed")
      const nextVisual = JSON.parse(params[3] as string)
      for (const item of this.items) {
        if (item.quoteId !== params[0] || item.productId !== params[1] || item.deleted || !item.snapshot) continue
        if (item.snapshot.image === params[2] && JSON.stringify(item.snapshot.visualAsset) === JSON.stringify(nextVisual)) continue
        item.snapshot = { ...item.snapshot, image: params[2], visualAsset: nextVisual }
        rows.push({ productSnapshot: structuredClone(item.snapshot) })
      }
    } else if (normalized.startsWith("update quotes set updated_at")) {
      const quote = this.quotes.find((candidate) => candidate.id === params[0])!
      quote.updatedAt = NEW_TIME
      rows = [{ updatedAt: NEW_TIME }]
    } else if (normalized.startsWith("insert into activity_logs")) {
      if (this.options.failAt === "audit") throw new Error("audit write failed")
    } else throw new Error(`Unexpected test query: ${normalized}`)
    return { rows: rows as T[], rowCount: rows.length }
  }
}
const dependencies = (db: RefreshDatabase) => ({ db: db as never })
const writes = (db: RefreshDatabase) => db.calls.filter(({ sql }) => /^(update|insert|delete)\b/i.test(sql.trim()))

describe("quote photo refresh boundary", () => {
  it("rejects unauthenticated, disabled and malformed inputs before opening a database connection", async () => {
    const db = new RefreshDatabase()
    await expect(refreshQuoteImages(null, input, dependencies(db))).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" })
    const disabled = account(); disabled.account.status = "disabled"
    await expect(refreshQuoteImages(disabled, input, dependencies(db))).rejects.toMatchObject({ status: 403, code: "ACCOUNT_DISABLED" })
    for (const patch of [{ projectId: "bad" }, { quoteId: "bad" }, { expectedUpdatedAt: "not-a-date" }]) await expect(refreshQuoteImages(account(), { ...input, ...patch }, dependencies(db))).rejects.toMatchObject({ status: expect.any(Number) })
    expect(db.connections).toBe(0)
  })

  it("does not read a quote or mutate another customer's invisible project", async () => {
    const db = new RefreshDatabase({ visible: false })
    await expect(refreshQuoteImages(account(true), input, dependencies(db))).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" })
    const query = db.calls.find(({ sql }) => sql.includes("from projects p"))!
    expect(query.params).toEqual([PROJECT, HISTORY, USER, USER])
    expect(query.sql).toContain("p.owner_id = $2::uuid")
    expect(db.calls.some(({ sql }) => sql.includes("from quotes"))).toBe(false)
    expect(writes(db)).toHaveLength(0)
    expect(db.released).toBe(true)
  })

  it("requires account edit permission and writable project membership independently", async () => {
    const denied = account(); denied.permissions = denied.permissions.filter((permission) => permission !== "project.edit")
    const noPermission = new RefreshDatabase()
    await expect(refreshQuoteImages(denied, input, dependencies(noPermission))).rejects.toMatchObject({ status: 403, code: "ROLE_PERMISSION_DENIED" })
    const viewer = new RefreshDatabase({ accessLevel: "view" })
    await expect(refreshQuoteImages(account(true), input, dependencies(viewer))).rejects.toMatchObject({ status: 403, code: "PROJECT_READ_ONLY" })
    for (const db of [noPermission, viewer]) { expect(writes(db)).toHaveLength(0); expect(db.calls.some(({ sql }) => sql.includes("from quotes"))).toBe(false) }
  })

  it("allows an editor of a visible team project while locking the current draft", async () => {
    const db = new RefreshDatabase({ accessLevel: "edit" })
    await expect(refreshQuoteImages(account(true), input, dependencies(db))).resolves.toMatchObject({ quoteId: QUOTE, updated: 3 })
    expect(db.calls.find(({ sql }) => sql.includes("from quotes"))?.sql).toContain("for update")
    expect(db.calls.find(({ sql }) => sql.includes("from quotes"))?.params).toEqual([PROJECT])
  })

  it.each(["grace_period", "expired", "past_due"] as const)("does not refresh photos for a %s subscription", async (subscriptionStatus) => {
    const context = account(); context.account.subscriptionStatus = subscriptionStatus
    const db = new RefreshDatabase()
    await expect(refreshQuoteImages(context, input, dependencies(db))).rejects.toMatchObject({ status: 403, code: "SUBSCRIPTION_EXPIRED" })
    expect(writes(db)).toHaveLength(0)
  })

  it.each([{ quoteId: HISTORY }, { expectedUpdatedAt: "2026-10-15T00:59:59Z" }])("rejects stale quote identity or timestamp before any image or quote write: %j", async (patch) => {
    const db = new RefreshDatabase()
    await expect(refreshQuoteImages(account(), { ...input, ...patch }, dependencies(db))).rejects.toMatchObject({ status: 409, code: "QUOTE_IMAGE_REFRESH_CONFLICT" })
    expect(writes(db)).toHaveLength(0)
    expect(db.calls.some(({ sql }) => sql.includes("from products"))).toBe(false)
    expect(db.calls.at(-1)?.sql).toBe("rollback")
  })

  it("requires an existing current draft instead of refreshing a sent quote", async () => {
    const db = new RefreshDatabase(); db.quotes[0].status = "sent"
    await expect(refreshQuoteImages(account(), input, dependencies(db))).rejects.toMatchObject({ status: 409, code: "QUOTE_IMAGE_REFRESH_CONFLICT" })
    expect(writes(db)).toHaveLength(0)
  })

  it("updates current draft photo fields while preserving row metadata, rooms, quantities, money, history and removed rows", async () => {
    const db = new RefreshDatabase()
    const before = structuredClone({ quotes: db.quotes, items: db.items })
    const result = await refreshQuoteImages(account(), input, dependencies(db))
    expect(result).toMatchObject({ quoteId: QUOTE, updatedAt: NEW_TIME, updated: 3 })
    expect(result.products.map((product) => product.id)).toEqual([SWITCH, AP])
    for (const item of db.items) {
      const original = before.items.find((candidate) => candidate.id === item.id)!
      expect({ ...item, snapshot: null }).toEqual({ ...original, snapshot: null })
      if (item.id === "living" || item.id === "dining") {
        expect(item.snapshot).toMatchObject({ ...original.snapshot, image: visual.image, visualAsset: { image: visual.image, crop: visual.crop, scale: 1.3, revision: 4, reviewStatus: "series" } })
      } else if (item.id === "legacy") {
        expect(item.snapshot).toMatchObject({ name: "原报价AP", spec: "原报价规格", image: "/assets/ap.png", visualAsset: null })
      } else expect(item).toEqual(original)
    }
    expect(db.quotes).toEqual(before.quotes.map((quote) => quote.id === QUOTE ? { ...quote, updatedAt: NEW_TIME } : quote))
    for (const call of writes(db).filter(({ sql }) => /^update quote_items/i.test(sql.trim()))) {
      expect(call.params[0]).toBe(QUOTE)
      const setClause = call.sql.toLowerCase().split(/\bset\b/)[1].split(/\bfrom\b|\bwhere\b/)[0]
      expect(setClause).not.toMatch(/\b(quantity|price|cost|room|room_id|unit_price|discount)\s*=/)
    }
    expect(db.calls.at(-1)?.sql).toBe("commit")
    expect(db.released).toBe(true)
  })

  it("keeps old images and visual assets if the catalog has only empty or placeholder new images", async () => {
    const db = new RefreshDatabase()
    db.products.forEach((product) => { product.image = product.id === SWITCH ? "" : "/placeholder.png" }); db.visuals = []
    const before = structuredClone({ quotes: db.quotes, items: db.items })
    const result = await refreshQuoteImages(account(), input, dependencies(db))
    expect(result).toEqual({ quoteId: QUOTE, updatedAt: OLD_TIME, updated: 0, products: [] })
    expect({ quotes: db.quotes, items: db.items }).toEqual(before)
    expect(writes(db)).toHaveLength(0)
  })

  it("does not rewrite photos, quote time or audit records on an unchanged second refresh", async () => {
    const db = new RefreshDatabase()
    await refreshQuoteImages(account(), input, dependencies(db))
    const before = structuredClone({ quotes: db.quotes, items: db.items })
    const writesBefore = writes(db).length
    const result = await refreshQuoteImages(account(), { ...input, expectedUpdatedAt: NEW_TIME }, dependencies(db))
    expect(result).toEqual({ quoteId: QUOTE, updatedAt: NEW_TIME, updated: 0, products: [] })
    expect({ quotes: db.quotes, items: db.items }).toEqual(before)
    // Conditional image UPDATE statements may match no rows; timestamps/audit must stay untouched.
    expect(writes(db).slice(writesBefore).some(({ sql }) => /update quotes|insert into activity_logs/i.test(sql))).toBe(false)
  })

  it("clears derivative framing when its image is unusable and the catalog photo is used instead", async () => {
    const db = new RefreshDatabase(); db.visuals[0].image = "/placeholder.png"
    await refreshQuoteImages(account(), input, dependencies(db))
    expect(db.items.find((item) => item.id === "living")?.snapshot).toMatchObject({ image: "/assets/catalog-switch.png", visualAsset: null })
  })

  it.each(["image", "audit"] as const)("rolls back the complete photo refresh if %s writing fails", async (failAt) => {
    const db = new RefreshDatabase({ failAt })
    const before = structuredClone({ quotes: db.quotes, items: db.items })
    await expect(refreshQuoteImages(account(), input, dependencies(db))).rejects.toThrow(failAt === "image" ? "image update failed" : "audit write failed")
    expect({ quotes: db.quotes, items: db.items }).toEqual(before)
    expect(db.calls.at(-1)?.sql).toBe("rollback")
    expect(db.released).toBe(true)
  })
})
