import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildAccountContext } from "../lib/account-context"
import { normalizeDesignPlan } from "../lib/point-map-design"
import type { PointMapPlan } from "../lib/point-map-plan"
import { deliveryLineTotal, deliveryLineUnitPrice, summarizeDelivery, type ProjectDeliveryQuote, type ProjectDeliveryQuoteItem, type ProjectDeliverySnapshot } from "../lib/project-delivery"
import { assertDeliverySources, createProjectDelivery, deliveryFingerprint, freezeDeliveryImage, getProjectDelivery, listProjectDeliveries, previewProjectDelivery } from "../lib/project-delivery-service"
import type { ProductVisualAsset } from "../lib/product-visual-assets"

const PROJECT = "11111111-1111-4111-8111-111111111111"
const USER = "22222222-2222-4222-8222-222222222222"
const PRODUCT = "33333333-3333-4333-8333-333333333333"
const OTHER_PRODUCT = "44444444-4444-4444-8444-444444444444"
const QUOTE = "55555555-5555-4555-8555-555555555555"
const DELIVERY = "66666666-6666-4666-8666-666666666666"
const NOW = new Date("2026-10-15T04:00:00.000Z")
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

function account(type: "PERSONAL_PRO" | "PERSONAL_FREE" | "ENTERPRISE_MEMBER" = "PERSONAL_PRO") {
  return buildAccountContext(
    { userId: USER, name: "Synthetic user", role: "pro" },
    { id: USER, account_type: type, account_status: "active", role: "pro" },
    type === "ENTERPRISE_MEMBER" ? { id: QUOTE, name: "Synthetic team", role: "editor" } : null,
  )
}

function plan(): PointMapPlan {
  return normalizeDesignPlan({
    projectId: PROJECT, floorplanName: "floor.png", floorplanDataUrl: PNG, updatedAt: NOW.toISOString(), schemaVersion: 3,
    activeFloorId: "floor-1", floors: [{ id: "floor-1", name: "一楼", floorplanName: "floor.png", floorplanDataUrl: PNG, imageWidth: 1, imageHeight: 1 }],
    points: [{ id: "point-1", name: "开关", code: "K01", floorId: "floor-1", room: "客厅", x: 20, y: 30, iconId: "switch-1", status: "confirmed", placed: true, usage: "selected", productId: PRODUCT, note: "" }], scenes: [],
  })
}

function quoteItem(overrides: Partial<ProjectDeliveryQuoteItem> = {}): ProjectDeliveryQuoteItem {
  return { id: PRODUCT, lineId: "line-1", name: "原报价商品名", spec: "单开", sku: "SKU-A", category: "开关", unit: "个", price: 10, cost: 4, quantity: 1, discount: 97.5, finalUnitPrice: 9.75, subtotalAmount: 10, finalAmount: 9.75, room: "一楼 / 客厅", image: "/assets/old.png", pointMapProjectId: PROJECT, pointIds: ["point-1"], pointMapRevision: 1, productSnapshot: { name: "原报价商品名", image: "/assets/old.png", capturedAt: "2026-10-14" }, ...overrides }
}

function quote(): ProjectDeliveryQuote {
  return { id: QUOTE, title: "原报价", quoteNo: "QT-SYNTHETIC", status: "draft", subtotal: 10, discount: 0.25, total: 10.08, installationFee: 0.33, rooms: ["一楼 / 客厅"], items: [quoteItem()] }
}

class MemoryClient {
  calls: Array<{ sql: string; params: unknown[] }> = []
  released = false
  visible = true
  accessLevel: string | null = null
  createdBy = USER
  draft: { plan: PointMapPlan; revision: number } | null = { plan: plan(), revision: 2 }
  savedQuote: ProjectDeliveryQuote | null = quote()
  catalog = [{ id: PRODUCT, name: "产品库后来改名", image: "/assets/new.png" }]
  deliveries: ProjectDeliverySnapshot[] = []
  failInsert: unknown = null

  async query<T>(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params })
    const text = sql.replace(/\s+/g, " ").trim().toLowerCase()
    let rows: unknown[] = []
    if (/^(begin|commit|rollback)/.test(text)) { /* Transaction shape is asserted below. */ }
    else if (text.includes("from projects p")) rows = this.visible ? [{ createdBy: this.createdBy, accessLevel: this.accessLevel }] : []
    else if (text.startsWith("select id::text, name, coalesce(code")) rows = [{ id: PROJECT, name: "Synthetic project", code: "SYNTH", customer: "Synthetic customer", address: "Synthetic address" }]
    else if (text.startsWith("select plan, revision")) rows = this.draft ? [structuredClone(this.draft)] : []
    else if (text.startsWith("select exists(select 1 from project_point_map_designs")) rows = [{ exists: this.draft !== null }]
    else if (text.startsWith("select id::text, quote_no")) rows = this.savedQuote ? [{ ...structuredClone(this.savedQuote), note: JSON.stringify({ installationFee: this.savedQuote.installationFee, rooms: this.savedQuote.rooms }) }] : []
    else if (text.startsWith("select qi.id::text")) rows = structuredClone(this.savedQuote?.items ?? [])
    else if (text.startsWith("select id::text, name, image from products")) rows = this.catalog.filter((product) => (params[0] as string[]).includes(product.id))
    else if (text.startsWith("select snapshot from project_deliveries")) rows = this.deliveries.filter((delivery) => text.includes("fingerprint = $2") ? delivery.fingerprint === params[1] : text.includes("id = $2::uuid") ? delivery.id === params[1] : true).toSorted((a, b) => b.version - a.version).slice(0, 1).map((snapshot) => ({ snapshot: structuredClone(snapshot) }))
    else if (text.startsWith("select jsonb_build_object")) rows = this.deliveries.toSorted((a, b) => b.version - a.version).map((snapshot) => ({ summary: summarizeDelivery(snapshot) }))
    else if (text.startsWith("insert into project_deliveries")) {
      if (this.failInsert) { const error = this.failInsert; this.failInsert = null; throw error }
      this.deliveries.push(JSON.parse(params[4] as string))
    } else throw new Error(`Unexpected query ${text}`)
    return { rows: rows as T[], rowCount: rows.length }
  }
  release() { this.released = true }
}

function deps(client: MemoryClient, assets: Map<string, ProductVisualAsset> = new Map()) {
  let idSequence = 0
  return { db: { connect: async () => client } as never, now: () => NOW, createId: () => idSequence++ === 0 ? DELIVERY : `77777777-7777-4777-8777-${String(idSequence).padStart(12, "0")}`,
    loadVisualAssets: vi.fn(async (_db, ids: string[]) => new Map([...assets].filter(([id]) => ids.includes(id)))),
    freezeImage: vi.fn(async (source: string) => `data:image/png;base64,${Buffer.from(source).toString("base64")}`) }
}

describe("immutable project delivery snapshots", () => {
  it("freezes an unverified default-model quote without pretending unplaced points are located", async () => {
    const client = new MemoryClient()
    client.draft!.plan.points[0] = { ...client.draft!.plan.points[0], productId: "", usage: "proposed", placed: false, status: "pending" }
    client.savedQuote!.items[0].productSnapshot = { quotationVerification: { status: "unverified", source: "default", reasons: ["默认型号尚未逐点确认", "布局尚未完成定位或设计确认"] } }
    const dependencies = deps(client)
    const first = await createProjectDelivery(account(), PROJECT, dependencies)
    expect(first.plan.points[0].placed).toBe(false)
    expect(first.quote!.items[0].productSnapshot!.quotationVerification).toMatchObject({ status: "unverified", source: "default" })
    client.savedQuote!.items[0].productSnapshot = { quotationVerification: { status: "verified", source: "selection", reasons: [] } }
    const historical = await getProjectDelivery(account(), PROJECT, first.id!, dependencies)
    expect(historical.quote!.items[0].productSnapshot!.quotationVerification).toMatchObject({ status: "unverified", source: "default" })
    await expect(createProjectDelivery(account(), PROJECT, dependencies)).rejects.toMatchObject({ code: "DELIVERY_SOURCE_CONFLICT" })
  })
  it("previews without writes, captures current used photos and preserves the original quote identity and decimal money", async () => {
    const client = new MemoryClient()
    const dependencies = deps(client)
    const original = structuredClone(client.savedQuote)
    const snapshot = await previewProjectDelivery(account(), PROJECT, dependencies)
    expect(snapshot).toMatchObject({ id: null, version: 0, pointMapRevision: 2, quote: { id: QUOTE, quoteNo: "QT-SYNTHETIC", total: 10.08, discount: 0.25, installationFee: 0.33, items: [{ name: "原报价商品名", price: 10, finalUnitPrice: 9.75, finalAmount: 9.75, imageSource: "/assets/new.png" }] } })
    expect(snapshot.quote!.items[0].image).toBe(snapshot.products[0].image)
    expect(snapshot.quote!.items[0].productSnapshot!.capturedAt).toBe("2026-10-14")
    expect(client.savedQuote).toEqual(original)
    expect(dependencies.loadVisualAssets.mock.calls[0][1]).toEqual([PRODUCT])
    expect(client.calls.some(({ sql }) => /^(insert|update|delete)/i.test(sql.trim()))).toBe(false)
    expect(client.calls[0].sql).toBe("begin isolation level repeatable read read only")
  })

  it("filters internal costs from preview and historical snapshots for ordinary members", async () => {
    const client = new MemoryClient()
    client.savedQuote!.items[0].productSnapshot = { name: "原报价商品名", cost: 4, nested: { costPrice: 5 }, image: "/assets/old.png" }
    const editor = account("ENTERPRISE_MEMBER")
    const preview = await previewProjectDelivery(editor, PROJECT, deps(client))
    expect(preview.quote!.items[0]).not.toHaveProperty("cost")
    expect(preview.quote!.items[0].productSnapshot).not.toHaveProperty("cost")
    expect(preview.quote!.items[0].productSnapshot?.nested).not.toHaveProperty("costPrice")

    const stored = await createProjectDelivery(account(), PROJECT, deps(client))
    expect(stored.quote!.items[0].cost).toBe(4)
    const historical = await getProjectDelivery(editor, PROJECT, stored.id!, deps(client))
    expect(historical.quote!.items[0]).not.toHaveProperty("cost")
    expect(historical.quote!.items[0].productSnapshot).not.toHaveProperty("cost")
  })

  it("freezes visual derivatives and crop settings while treating remote source-image evidence as provenance", async () => {
    const client = new MemoryClient()
    const visual: ProductVisualAsset = { image: "/assets/clean.png", sourceImage: "https://official.example/original.png", crop: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 }, scale: 1.2, reviewStatus: "verified", revision: 3, updatedAt: NOW.toISOString(), evidence: "official" }
    const dependencies = deps(client, new Map([[PRODUCT, visual]]))
    const snapshot = await createProjectDelivery(account(), PROJECT, dependencies)
    expect(snapshot.products[0].visualAsset).toMatchObject({ crop: visual.crop, scale: 1.2, image: snapshot.products[0].image, sourceImage: visual.sourceImage })
    expect(snapshot.quote!.items[0].productSnapshot!.visualAsset).toEqual(snapshot.products[0].visualAsset)
    expect(dependencies.freezeImage.mock.calls).toEqual([["/assets/clean.png"]])
    expect(client.calls.some(({ sql }) => sql.includes("for update of p"))).toBe(true)
    expect(client.calls.filter(({ sql }) => /^(insert|update|delete)/i.test(sql.trim())).map(({ sql }) => sql.trim().split(" ").slice(0, 3).join(" "))).toEqual(["insert into project_deliveries"])
  })

  it("does not apply a rejected visual image's crop to a catalogue fallback", async () => {
    const client = new MemoryClient()
    const asset: ProductVisualAsset = { image: "/placeholder.svg", sourceImage: "/assets/source.png", crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }, scale: 1.8, reviewStatus: "pending", revision: 1, updatedAt: NOW.toISOString() }
    client.savedQuote!.items[0].productSnapshot!.visualAsset = asset
    const snapshot = await previewProjectDelivery(account(), PROJECT, deps(client, new Map([[PRODUCT, asset]])))
    expect(snapshot.products[0]).toMatchObject({ imageSource: "/assets/new.png", visualAsset: null })
    expect(snapshot.quote!.items[0].productSnapshot!.visualAsset).toBeUndefined()
  })

  it("reuses identical content after a display-only revision bump and retains historical photos after catalogue changes", async () => {
    const client = new MemoryClient()
    const dependencies = deps(client)
    const first = await createProjectDelivery(account(), PROJECT, dependencies)
    client.draft!.revision = 3
    client.draft!.plan.updatedAt = "2026-10-16T00:00:00Z"
    client.savedQuote!.items[0].pointMapRevision = 3
    client.savedQuote!.items[0].productSnapshot!.capturedAt = "2026-10-16"
    const reused = await createProjectDelivery(account(), PROJECT, dependencies)
    expect(reused).toEqual({ ...first, reused: true })
    expect(client.deliveries).toHaveLength(1)
    client.catalog[0].image = "/assets/newest.png"
    const second = await createProjectDelivery(account(), PROJECT, dependencies)
    expect(second.version).toBe(2)
    expect(second.changes.photosChanged).toEqual([PRODUCT])
    expect(second.changes.quoteChanged).toBe(false)
    dependencies.freezeImage.mockClear()
    dependencies.loadVisualAssets.mockClear()
    const old = await getProjectDelivery(account(), PROJECT, first.id!, dependencies)
    expect(old).toEqual(first)
    expect(old.quote!.total).toBe(10.08)
    expect(dependencies.freezeImage).not.toHaveBeenCalled()
    expect(dependencies.loadVisualAssets).not.toHaveBeenCalled()
    expect(await listProjectDeliveries(account(), PROJECT, dependencies)).toHaveLength(2)
  })

  it("does not create a partial version if source validation or image archiving fails", async () => {
    const client = new MemoryClient()
    client.savedQuote!.items[0].quantity = 2
    await expect(createProjectDelivery(account(), PROJECT, deps(client))).rejects.toMatchObject({ code: "DELIVERY_SOURCE_CONFLICT", status: 409, issues: [expect.stringContaining("报价数量 2")] })
    expect(client.deliveries).toEqual([])
    expect(client.calls.at(-1)?.sql).toBe("rollback")
    client.savedQuote!.items[0].quantity = 1
    const dependencies = deps(client)
    dependencies.freezeImage.mockRejectedValue(new Error("archive failed"))
    await expect(createProjectDelivery(account(), PROJECT, dependencies)).rejects.toThrow("archive failed")
    expect(client.deliveries).toEqual([])
  })

  it("retries a concurrent repeatable-read insert conflict using a fresh transaction", async () => {
    const client = new MemoryClient()
    client.failInsert = Object.assign(new Error("synthetic concurrent version"), { code: "23505" })
    const snapshot = await createProjectDelivery(account(), PROJECT, deps(client))
    expect(snapshot.version).toBe(1)
    expect(client.deliveries).toHaveLength(1)
    expect(client.calls.filter(({ sql }) => sql.startsWith("begin"))).toHaveLength(2)
    expect(client.calls.some(({ sql }) => sql === "rollback")).toBe(true)
  })

  it("checks authentication, visibility and independent create permissions without exposing another project", async () => {
    await expect(previewProjectDelivery(null, PROJECT)).rejects.toMatchObject({ status: 401 })
    const client = new MemoryClient()
    client.visible = false
    await expect(getProjectDelivery(account(), PROJECT, DELIVERY, deps(client))).rejects.toMatchObject({ status: 404 })
    expect(client.calls.some(({ sql }) => sql.includes("project_deliveries"))).toBe(false)
    client.visible = true
    const reader = account(); reader.permissions = reader.permissions.filter((permission) => permission !== "project.edit")
    await expect(previewProjectDelivery(reader, PROJECT, deps(client))).resolves.toBeDefined()
    await expect(createProjectDelivery(reader, PROJECT, deps(client))).rejects.toMatchObject({ status: 403 })
    await expect(previewProjectDelivery(account("PERSONAL_FREE"), PROJECT, deps(client))).rejects.toMatchObject({ status: 403 })
    client.createdBy = PRODUCT; client.accessLevel = "view"
    await expect(createProjectDelivery(account("ENTERPRISE_MEMBER"), PROJECT, deps(client))).rejects.toMatchObject({ code: "PROJECT_READ_ONLY" })
  })

  it("rejects missing saved plans and malformed or unrelated historical IDs", async () => {
    const client = new MemoryClient(); client.draft = null
    await expect(previewProjectDelivery(account(), PROJECT, deps(client))).rejects.toMatchObject({ code: "DELIVERY_PLAN_REQUIRED" })
    await expect(getProjectDelivery(account(), PROJECT, "bad-id", deps(client))).rejects.toMatchObject({ status: 404 })
    await expect(getProjectDelivery(account(), PROJECT, DELIVERY, deps(client))).rejects.toMatchObject({ status: 404 })
  })

  it("distinguishes a visible pure quote before paid gates but never bypasses them for an existing point plan", async () => {
    const client = new MemoryClient(); client.draft = null
    const free = account("PERSONAL_FREE")
    await expect(createProjectDelivery(free, PROJECT, deps(client))).rejects.toMatchObject({ code: "DELIVERY_PLAN_REQUIRED", status: 409 })
    expect(client.deliveries).toEqual([])
    expect(client.calls.some(({ sql }) => sql.includes("from quote_items"))).toBe(false)
    client.draft = { plan: plan(), revision: 1 }
    await expect(createProjectDelivery(free, PROJECT, deps(client))).rejects.toMatchObject({ status: 403, code: "POINT_MAP_NOT_INCLUDED" })
    client.visible = false; client.draft = null
    await expect(createProjectDelivery(free, PROJECT, deps(client))).rejects.toMatchObject({ status: 404 })
  })

  it.each(["expired", "past_due", "grace_period"] as const)("retains historical read access for %s while rejecting create", async (status) => {
    const client = new MemoryClient(), dependencies = deps(client)
    const saved = await createProjectDelivery(account(), PROJECT, dependencies)
    const expired = account(); expired.account.subscriptionStatus = status
    await expect(getProjectDelivery(expired, PROJECT, saved.id!, dependencies)).resolves.toEqual(saved)
    await expect(listProjectDeliveries(expired, PROJECT, dependencies)).resolves.toHaveLength(1)
    await expect(createProjectDelivery(expired, PROJECT, dependencies)).rejects.toMatchObject({ status: 403 })
  })
})

describe("delivery source contracts and amounts", () => {
  it("accepts legacy room names that already include their floor prefix", () => {
    const current = plan()
    current.points[0].room = "一楼 / 客厅"
    expect(assertDeliverySources(current, quote())).toBe(0)
  })

  it("respects exact quote selection over a different draft product without revision-only conflicts", () => {
    const current = plan(), saved = quote()
    current.points[0].productId = OTHER_PRODUCT
    saved.items[0].pointMapRevision = 1
    expect(assertDeliverySources(current, saved)).toBe(1)
    expect(deliveryLineUnitPrice(saved.items[0])).toBe(9.75)
    expect(deliveryLineTotal(saved.items[0])).toBe(9.75)
    expect(deliveryLineUnitPrice({ price: 19.99, discount: 97.5 })).toBe(19.99 * 0.975)
  })

  it("reports removed, duplicate, foreign and moved source points precisely", () => {
    const current = plan(), saved = quote()
    saved.items[0].pointIds = ["point-1", "point-1", "removed"]
    saved.items[0].room = "旧房间"
    expect(() => assertDeliverySources(current, saved)).toThrow("点位与已保存报价需要核对")
    try { assertDeliverySources(current, saved) } catch (error) {
      expect(error).toMatchObject({ issues: expect.arrayContaining([expect.stringContaining("重复"), expect.stringContaining("已不存在"), expect.stringContaining("房间已变")]) })
    }
    saved.items = [quoteItem(), quoteItem({ id: OTHER_PRODUCT, lineId: "line-2" })]
    expect(() => assertDeliverySources(current, saved)).toThrow()
    saved.items = [quoteItem({ pointMapProjectId: PRODUCT })]
    expect(() => assertDeliverySources(current, saved)).toThrow()
  })

  it("checks explicit material quantities separately from the main device", () => {
    const current = plan(), saved = quote()
    current.points[0].materials = [{ id: "track", productId: OTHER_PRODUCT, role: "track", required: true, included: false, unit: "米", quantity: 3.25 }]
    saved.items.push(quoteItem({ id: OTHER_PRODUCT, lineId: "track-row", name: "轨道", unit: "米", quantity: 3.25 }))
    expect(assertDeliverySources(current, saved)).toBe(0)
    saved.items[1].quantity = 3
    expect(() => assertDeliverySources(current, saved)).toThrow()
  })

  it("keeps layout and money changes in the content fingerprint", async () => {
    const client = new MemoryClient(), snapshot = await previewProjectDelivery(account(), PROJECT, deps(client))
    const changed = structuredClone(snapshot)
    changed.plan.points[0].x++
    expect(deliveryFingerprint(changed)).not.toBe(snapshot.fingerprint)
    changed.plan.points[0].x--
    changed.quote!.total += 0.01
    expect(deliveryFingerprint(changed)).not.toBe(snapshot.fingerprint)
  })
})

const temporary: string[] = []
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }) })
describe("safe immutable image archiving", () => {
  it("keeps raster data URLs and freezes only local public/assets files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fmkj-delivery-")); temporary.push(directory)
    await mkdir(path.join(directory, "assets"))
    await writeFile(path.join(directory, "assets", "photo.png"), Buffer.from(PNG.split(",")[1], "base64"))
    expect(await freezeDeliveryImage(PNG)).toBe(PNG)
    const frozen = await freezeDeliveryImage("/assets/photo.png?v=2", { publicDirectory: directory })
    expect(frozen).toBe(PNG)
    await writeFile(path.join(directory, "assets", "photo.png"), "changed")
    expect(frozen).toBe(PNG)
  })

  it("rejects remote URLs, traversal, symlink escapes, oversized and non-image files without fetching", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fmkj-delivery-")); temporary.push(directory)
    await mkdir(path.join(directory, "assets"))
    await writeFile(path.join(directory, "secret.png"), Buffer.from(PNG.split(",")[1], "base64"))
    await writeFile(path.join(directory, "assets", "fake.png"), "not an image")
    await symlink(path.join(directory, "secret.png"), path.join(directory, "assets", "escape.png"))
    for (const source of ["https://127.0.0.1/private.png", "file:///etc/passwd", "//host/image.png", "/assets/../secret.png", "/assets/%2e%2e/secret.png", "/assets/escape.png", "/assets/fake.png", "/assets/missing.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
      await expect(freezeDeliveryImage(source, { publicDirectory: directory })).rejects.toMatchObject({ status: expect.any(Number) })
    }
    await expect(freezeDeliveryImage(PNG, { maxBytes: 1 })).rejects.toMatchObject({ code: "DELIVERY_IMAGE_INVALID" })
  })
})
