import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"

import type { ProductRow } from "../lib/product-admin-service"
import type { PointMapNode, PointMapPlan } from "../lib/point-map-plan"
import { hydratePlanSelections } from "../lib/point-map-selection-service"
import type { PointSelectionSnapshot } from "../lib/product-selection"
import { saveQuoteDraft, type QuoteItemPayload } from "../lib/quote-save"

const PROJECT = "11111111-1111-4111-8111-111111111111"
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222"
const PRODUCT = "33333333-3333-4333-8333-333333333333"
const OTHER_PRODUCT = "44444444-4444-4444-8444-444444444444"
const QUOTE = "55555555-5555-4555-8555-555555555555"
const OTHER_QUOTE = "66666666-6666-4666-8666-666666666666"
const ACTOR = "77777777-7777-4777-8777-777777777777"
const TIME = "2026-10-14T00:00:00.000Z"
const ROOM = "一楼 / 客厅"

const rawProduct = (patch: Partial<ProductRow> = {}): ProductRow => ({
  id: PRODUCT, name: "现售三键开关", sku: "CURRENT-3N", manufacturer_model: "NEW-MODEL", unit: "个",
  status: "approved", category: "开关", brand: "合成测试品牌", platform: "米家", price: 300, cost: 150, stock: 10,
  image: "/new-catalog-image.svg", description: "现售规格说明", tags: [], channels: [],
  created_at: TIME, updated_at: TIME, review_note: null, reviewed_at: null, reviewed_by: null, submitted_by: null,
  catalog_kind: "sku", device_type_id: "wall-switch", parent_product_id: null,
  specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: ["ble-mesh"], capabilities: ["load-control"],
  selection_status: "verified", selection_evidence: "合成产品安装说明", pricing_status: "verified", pricing_evidence: "合成报价单", mapping_revision: 3,
  ...patch,
})

const selection = (patch: Partial<PointSelectionSnapshot> = {}): PointSelectionSnapshot => ({
  productId: PRODUCT, mappingRevision: 3, deviceTypeId: "wall-switch", sku: "CURRENT-3N", name: "现售三键开关",
  manufacturerModel: "NEW-MODEL", specs: { button_count: 3, relay_count: 2, wiring: "neutral" },
  protocols: ["ble-mesh"], capabilities: ["load-control"], unit: "个", verifiedAt: TIME, verifiedBy: ACTOR,
  ...patch,
})

const point = (patch: Partial<PointMapNode> = {}): PointMapNode => ({
  id: "point-1", floorId: "ground", code: "K01", name: "客厅三键面板", room: "客厅", iconId: "switch-3",
  status: "confirmed", x: 20.123456, y: 30.654321, placed: true, productId: PRODUCT, note: "保留现场备注",
  deviceTypeId: "wall-switch", requirements: { button_count: 3, relay_count: 2, wiring: "neutral" }, usage: "selected",
  selection: selection(), ...patch,
})

const plan = (points: PointMapNode[] = [point()]): PointMapPlan => ({
  projectId: PROJECT, schemaVersion: 3, floorplanName: "", floorplanDataUrl: "", updatedAt: TIME,
  floors: [{ id: "ground", name: "一楼", floorplanName: "", floorplanDataUrl: "", imageWidth: 1, imageHeight: 1 }], points,
})

const quoteItem = (patch: Partial<QuoteItemPayload> = {}): QuoteItemPayload => ({
  productId: PRODUCT, name: "原报价名称", spec: "原报价规格", room: ROOM, unit: "个", quantity: 1,
  price: 325, cost: 160, discount: 87.5, ...patch,
})

type FrozenRow = { product_id: string; room: string; product_snapshot: Record<string, unknown> | null }
type Call = { sql: string; params: unknown[] }

/** Execute the real SELECT predicate in memory, rather than hard-coding an expected project response.
 * SQLite and Postgres share AND/OR/null/equality semantics used by this project lookup. */
function resolveSyntheticProjects(sql: string, params: unknown[]) {
  const memory = new DatabaseSync(":memory:")
  try {
    memory.exec("create table projects(id text, name text, created_at text, updated_at text, deleted_at text)")
    const insert = memory.prepare("insert into projects values (?, ?, ?, ?, null)")
    insert.run(PROJECT, "有权项目", TIME, "2026-10-13T00:00:00.000Z")
    insert.run(OTHER_PROJECT, "另一个同名诱导项目", TIME, "2026-10-14T00:00:00.000Z")
    const bindings: SQLInputValue[] = []
    const portable = sql.replace(/::(?:uuid|text)\b/gi, "").replace(/\$(\d+)/g, (_token, index) => {
      bindings.push(params[Number(index) - 1] as SQLInputValue)
      return "?"
    })
    return memory.prepare(portable).all(...bindings)
  } finally { memory.close() }
}

class ScenarioClient {
  readonly calls: Call[] = []
  readonly quoteWrites: unknown[][] = []
  released = false
  products = [rawProduct()]
  storedPlan = plan()
  storedRevision = 8
  snapshots: FrozenRow[] = []
  backup: { plan: PointMapPlan; revision: number } | null = null

  async query(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params })
    const compact = sql.replace(/\s+/g, " ").trim().toLowerCase()
    if (compact === "begin") { this.backup = { plan: structuredClone(this.storedPlan), revision: this.storedRevision }; return { rows: [] } }
    if (compact === "commit") { this.backup = null; return { rows: [] } }
    if (compact === "rollback") { if (this.backup) { this.storedPlan = this.backup.plan; this.storedRevision = this.backup.revision }; return { rows: [] } }
    if (compact.startsWith("update project_point_map_designs")) { this.storedPlan = JSON.parse(String(params[1])); this.storedRevision = Number(params[2]); return { rows: [] } }
    if (compact.includes("from projects")) return { rows: resolveSyntheticProjects(sql, params) }
    if (compact.includes("from project_point_map_designs")) return { rows: [{ plan: this.storedPlan, revision: this.storedRevision }] }
    if (compact.includes("from products")) {
      const ids = params[0] as string[]
      if (compact.includes("device_type_id = any")) return { rows: this.products.filter((product) => ids.includes(product.device_type_id!)) }
      return { rows: this.products.filter((product) => ids.includes(product.id)) }
    }
    if (compact.includes("from project_category_default_products")) return { rows: [] }
    if (compact.includes("from quote_items")) return { rows: params[0] === QUOTE ? this.snapshots : [] }
    if (compact.includes("from quotes")) return { rows: [{ id: params[0] === PROJECT ? QUOTE : OTHER_QUOTE, quote_no: "QT-SYNTHETIC" }] }
    if (compact.startsWith("update quotes")) return { rows: [{ id: params[0], quote_no: params[1] }] }
    if (compact.startsWith("insert into quote_items")) { this.quoteWrites.push(params); return { rows: [] } }
    if (compact.startsWith("insert into project_product_prices")) return { rows: [] }
    if (compact.includes("from project_product_prices")) return { rows: [] }
    if (compact.startsWith("insert into activity_logs")) return { rows: [{ id: "activity-synthetic" }] }
    if (compact.startsWith("delete from quote_items") || compact.startsWith("update projects")) return { rows: [] }
    throw new Error(`Unexpected query in quote security scenario: ${compact.slice(0, 120)}`)
  }

  release() { this.released = true }
}

const dependencies = (client: ScenarioClient) => ({
  db: { connect: async () => client } as never, actorUserId: ACTOR, actorName: "合成测试审核员", now: () => new Date(TIME),
})
const mutationCalls = (client: ScenarioClient) => client.calls.filter((call) => /^\s*(insert|update|delete)\s/i.test(call.sql))

describe("trusted server selection snapshots", () => {
  it("writes and returns the new revision after linked deletion, permitting the next save", async () => {
    const client = new ScenarioClient()
    client.storedPlan = plan([point(), point({ id: "surviving" })])
    const input = { projectId: PROJECT, pointMapRevision: 8, removedPointIds: ["point-1"], items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["surviving"] })] }
    expect(await saveQuoteDraft(input, dependencies(client))).toMatchObject({ pointMapRevision: 9 })
    expect(client.storedPlan.points.map((point) => point.id)).toEqual(["surviving"])
    expect(client.quoteWrites[0][16]).toBe(9)
    expect(JSON.parse(String(client.quoteWrites[0][17])).pointMapRevision).toBe(9)
    await expect(saveQuoteDraft({ ...input, pointMapRevision: 9, removedPointIds: [], items: input.items.map((item) => ({ ...item, pointMapRevision: 9 })) }, dependencies(client))).resolves.toMatchObject({ pointMapRevision: 9 })
  })
  it("requires a revision for deletion and rolls back rejected room moves", async () => {
    const client = new ScenarioClient()
    await expect(saveQuoteDraft({ projectId: PROJECT, removedPointIds: ["point-1"], items: [] }, dependencies(client))).rejects.toMatchObject({ status: 409 })
    expect(client.storedPlan.points).toHaveLength(1)
    await expect(saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, pointRoomMoves: [{ pointIds: ["point-1"], room: "二楼 / 书房" }], items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"], room: "二楼 / 书房" })] }, dependencies(client))).rejects.toThrow("跨楼层")
    expect(client.storedPlan.points[0].room).toBe("客厅")
    expect(client.storedRevision).toBe(8)
  })
  it("persists same-floor room changes without moving installation coordinates", async () => {
    const client = new ScenarioClient()
    const original = client.storedPlan.points[0]
    const room = "合成测试房间".repeat(16)
    await expect(saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, pointRoomMoves: [{ pointIds: ["point-1"], room: `一楼 / ${room}` }], items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"], room: `一楼 / ${room}` })] }, dependencies(client))).resolves.toMatchObject({ pointMapRevision: 9 })
    expect(client.storedPlan.points[0]).toMatchObject({ room, floorId: original.floorId, x: original.x, y: original.y })
  })
  it("persists default quotation as unverified even when a client forges verified metadata", async () => {
    const client = new ScenarioClient()
    client.products = [rawProduct({ selection_status: "pending", pricing_status: "pending" })]
    client.storedPlan = plan([point({ productId: "", usage: "proposed", placed: false, status: "pending", selection: undefined })])
    await saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, items: [quoteItem({
      pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"],
      productSnapshot: { quotationVerification: { status: "verified", source: "selection", reasons: [] } },
    })] }, dependencies(client))
    const stored = JSON.parse(String(client.quoteWrites[0][17]))
    expect(stored.quotationVerification).toMatchObject({ status: "unverified", source: "default" })
    expect(stored.quotationVerification.reasons).toContain("产品参数尚未核验")
    expect(client.quoteWrites[0][4]).toBe(325)
  })
  it("preserves a trusted stale snapshot across saves until an explicit reselect", async () => {
    const client = new ScenarioClient()
    const old = selection({ mappingRevision: 2, sku: "OLD-SKU", name: "原已选型号", verifiedAt: "2026-10-13T00:00:00.000Z" })
    const trusted = plan([point({ selection: old })])
    const submitted = structuredClone(trusted)
    const saved = await hydratePlanSelections(client as never, submitted, ACTOR, trusted)
    const repeated = await hydratePlanSelections(client as never, structuredClone(saved), ACTOR, saved)
    expect(repeated.points[0].selection).toEqual(old)
    expect(repeated.points[0]).toMatchObject({ id: "point-1", x: 20.123456, y: 30.654321, note: "保留现场备注" })
    expect(trusted.points[0].selection).toEqual(old)
  })

  it("drops a forged snapshot when the current product is incompatible", async () => {
    const client = new ScenarioClient()
    client.products = [rawProduct({ device_type_id: "wireless-ap", specs: { power: "poe", installation: "ceiling", wireless_standard: "802.11ax" } })]
    const trusted = plan()
    const forged = selection({ name: "伪造已审核型号", sku: "FORGED-SKU", verifiedBy: OTHER_PROJECT, verifiedAt: "2026-10-14T10:00:00.000Z" })
    const saved = await hydratePlanSelections(client as never, plan([point({ selection: forged })]), ACTOR, trusted)
    expect(saved.points[0].selection).toBeUndefined()
    expect(JSON.stringify(saved)).not.toContain("FORGED-SKU")
    expect(trusted.points[0].selection?.sku).toBe("CURRENT-3N")
  })

  it("replaces forged identity with catalog data and the actual actor for a valid selection", async () => {
    const client = new ScenarioClient()
    const forged = selection({ name: "伪造名字", sku: "FORGED-SKU", specs: { button_count: 4 }, verifiedBy: OTHER_PROJECT })
    const saved = await hydratePlanSelections(client as never, plan([point({ selection: forged })]), ACTOR, plan())
    expect(saved.points[0].selection).toMatchObject({ sku: "CURRENT-3N", name: "现售三键开关", mappingRevision: 3, specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, verifiedBy: ACTOR })
    expect(JSON.stringify(saved)).not.toContain("FORGED-SKU")
  })

  it("creates the current server snapshot when the user explicitly clears a stale selection", async () => {
    const client = new ScenarioClient()
    const trusted = plan([point({ selection: selection({ mappingRevision: 2, sku: "OLD-SKU" }) })])
    const saved = await hydratePlanSelections(client as never, plan([point({ selection: undefined })]), ACTOR, trusted)
    expect(saved.points[0].selection).toMatchObject({ sku: "CURRENT-3N", mappingRevision: 3, verifiedBy: ACTOR })
  })
})

describe("quote history protection through the save interface", () => {
  it.each([null, "", "/placeholder.svg", "javascript:alert(1)"])("does not replace a saved photo with an unusable catalog image (%s)", async (image) => {
    const client = new ScenarioClient()
    client.products = [rawProduct({ image })]
    client.snapshots = [{ product_id: PRODUCT, room: ROOM, product_snapshot: { version: 1, sku: "ISSUED-SKU", image: "/issued-photo.png" } }]
    await saveQuoteDraft({ projectId: PROJECT, refreshProductImages: true, items: [quoteItem()] }, dependencies(client))
    expect(JSON.parse(String(client.quoteWrites[0][17])).image).toBe("/issued-photo.png")
  })

  it.each([false, true])("refreshes only the current draft photo when explicitly requested (%s)", async (refreshProductImages) => {
    const client = new ScenarioClient()
    const frozen = { version: 1, origin: "quote-save", capturedAt: TIME, sku: "ISSUED-SKU", category: "原类别", image: "/issued-photo.png", specs: { button_count: 1 } }
    client.snapshots = [{ product_id: PRODUCT, room: ROOM, product_snapshot: frozen }]
    await saveQuoteDraft({ projectId: PROJECT, refreshProductImages, items: [quoteItem()] }, dependencies(client))
    expect(JSON.parse(String(client.quoteWrites[0][17]))).toMatchObject({
      ...frozen, image: refreshProductImages ? "/new-catalog-image.svg" : "/issued-photo.png",
    })
    expect(client.quoteWrites[0][4]).toBe(325)
    expect(client.quoteWrites[0][9]).toBe(284.38)   // 325 × 87.5% 取整到分
    expect(client.quoteWrites[0][10]).toBe(160)
    expect(client.storedRevision).toBe(8)
  })

  it.each([false, true])("keeps frozen unknown category/image after moving a room (snapshot supplied: %s)", async (supplied) => {
    const client = new ScenarioClient()
    const frozen = { version: 1, origin: "legacy-migration", capturedAt: "2026-10-13T00:00:00.000Z", sku: "ORIGINAL-SKU", category: null, image: null }
    client.snapshots = [{ product_id: PRODUCT, room: ROOM, product_snapshot: frozen }]
    await saveQuoteDraft({ projectId: PROJECT, items: [quoteItem({ room: "改名后的房间", ...(supplied ? { productSnapshot: structuredClone(frozen) } : {}) })] }, dependencies(client))
    const stored = JSON.parse(String(client.quoteWrites[0][17]))
    expect(stored).toMatchObject({ sku: "ORIGINAL-SKU", category: "", image: "/placeholder.svg", origin: "legacy-migration", capturedAt: frozen.capturedAt })
    expect(stored.image).not.toBe(client.products[0].image)
    expect(client.quoteWrites[0][6]).toBe("改名后的房间")
    expect(client.quoteWrites[0][4]).toBe(325)
    expect(client.quoteWrites[0][9]).toBe(284.38)   // 325 × 87.5% 取整到分
    expect(client.quoteWrites[0][10]).toBe(160)
    expect(client.released).toBe(true)
  })

  it("accepts only a snapshot that actually belongs to an existing quote row", async () => {
    const client = new ScenarioClient()
    client.snapshots = [{ product_id: PRODUCT, room: ROOM, product_snapshot: { version: 1, sku: "REAL-FROZEN-SKU", category: "原分类", image: "/old-frozen.svg" } }]
    await saveQuoteDraft({ projectId: PROJECT, items: [quoteItem({ productSnapshot: { sku: "FORGED-SKU", category: "假分类", image: "/forged.svg" } })] }, dependencies(client))
    const stored = JSON.parse(String(client.quoteWrites[0][17]))
    expect(stored).toMatchObject({ sku: "REAL-FROZEN-SKU", category: "原分类", image: "/old-frozen.svg" })
  })

  it("preserves distinct frozen snapshots for duplicate SKU/room rows", async () => {
    const client = new ScenarioClient()
    const first = { version: 1, sku: "ISSUED-A", image: "/old-a.svg", category: "第一行分类" }
    const second = { version: 1, sku: "ISSUED-B", image: "/old-b.svg", category: "第二行分类" }
    client.snapshots = [first, second].map((snapshot) => ({ product_id: PRODUCT, room: ROOM, product_snapshot: snapshot }))
    await saveQuoteDraft({ projectId: PROJECT, items: [quoteItem({ productSnapshot: first }), quoteItem({ productSnapshot: second })] }, dependencies(client))
    expect(client.quoteWrites.map((params) => JSON.parse(String(params[17])).sku)).toEqual(["ISSUED-A", "ISSUED-B"])
  })

  it("renews a newly synchronized source identity while preserving manual money fields", async () => {
    const client = new ScenarioClient()
    client.snapshots = [{ product_id: PRODUCT, room: ROOM, product_snapshot: { version: 1, pointMapRevision: 7, mappingRevision: 2, sku: "OLD-SKU", image: "/old.svg", category: "旧类别" } }]
    await saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"] })] }, dependencies(client))
    const stored = JSON.parse(String(client.quoteWrites[0][17]))
    expect(stored).toMatchObject({ sku: "CURRENT-3N", mappingRevision: 3, pointMapRevision: 8, image: "/new-catalog-image.svg", category: "开关" })
    expect(client.quoteWrites[0][4]).toBe(325)
    expect(client.quoteWrites[0][9]).toBe(284.38)   // 325 × 87.5% 取整到分
    expect(client.quoteWrites[0][10]).toBe(160)
  })
})

describe("server procurement provenance enforcement", () => {
  it("rejects a stale source version before any quote mutation", async () => {
    const client = new ScenarioClient()
    await expect(saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 7, items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 7, pointIds: ["point-1"] })] }, dependencies(client))).rejects.toMatchObject({ code: "POINT_MAP_REVISION_CONFLICT", status: 409 })
    expect(mutationCalls(client)).toEqual([])
    expect(client.calls.some((call) => call.sql === "rollback")).toBe(true)
    expect(client.released).toBe(true)
  })

  it.each([
    { productId: OTHER_PRODUCT },
    { quantity: 2 },
    { pointIds: ["forged-point-id"] },
    { unit: "套" },
  ])("rejects altered product, quantity, unit or point identities: %j", async (patch) => {
    const client = new ScenarioClient()
    const sourced = quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"], ...patch })
    await expect(saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, items: [sourced] }, dependencies(client))).rejects.toMatchObject({ status: 409 })
    expect(mutationCalls(client)).toEqual([])
    expect(client.quoteWrites).toEqual([])
  })

  it("rejects stale selection metadata even when the point-map revision is current", async () => {
    const client = new ScenarioClient()
    client.storedPlan = plan([point({ selection: selection({ mappingRevision: 2 }) })])
    await expect(saveQuoteDraft({ projectId: PROJECT, pointMapRevision: 8, items: [quoteItem({ pointMapProjectId: PROJECT, pointMapRevision: 8, pointIds: ["point-1"] })] }, dependencies(client))).rejects.toMatchObject({ status: 409 })
    expect(mutationCalls(client)).toEqual([])
  })

  it("resolves the requested project ID even when another supplied project name is newer", async () => {
    const client = new ScenarioClient()
    await saveQuoteDraft({ projectId: PROJECT, projectName: "另一个同名诱导项目", items: [quoteItem()] }, dependencies(client))
    const updatedProject = client.calls.find((call) => /^\s*update projects/i.test(call.sql))
    const updatedQuote = client.calls.find((call) => /^\s*update quotes/i.test(call.sql))
    expect(updatedProject?.params[0]).toBe(PROJECT)
    expect(updatedQuote?.params[0]).toBe(QUOTE)
    expect(updatedQuote?.params[2]).toBe("有权项目 报价草稿")
  })
})
