import { describe, expect, it, vi } from "vitest"

import { buildAccountContext } from "../lib/account-context"
import type { PointMapPlan } from "../lib/point-map-plan"
import { buildStoredProcurementPreview, previewPointMapProcurement } from "../lib/point-map-procurement-service"
import { refreshPointMapQuote } from "../lib/point-map-quote-refresh"
import type { ProductRow } from "../lib/product-admin-service"
import { consumePointMapQuoteSnapshot, writePointMapQuoteSnapshot } from "../lib/quote-draft"

const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222"
const USER_ID = "33333333-3333-4333-8333-333333333333"
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444"
const NOW = "2026-10-14T00:00:00.000Z"
const product: ProductRow = {
  id: PRODUCT_ID, name: "Synthetic switch", sku: "SYN-3N", unit: "个", category: "开关", brand: "Synthetic", platform: "Synthetic",
  status: "active", cost: 200, price: 300, created_at: NOW, updated_at: NOW, catalog_kind: "sku", device_type_id: "wall-switch",
  specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: [], capabilities: [], selection_status: "verified",
  selection_evidence: "Synthetic specification", pricing_status: "verified", pricing_evidence: "Synthetic price", mapping_revision: 2,
  channels: [], description: "3 keys", image: null, review_note: null, reviewed_at: null, reviewed_by: null,
  stock: 0, submitted_by: null, tags: [],
}
const plan: PointMapPlan = {
  projectId: PROJECT_ID, schemaVersion: 3, floorplanName: "", floorplanDataUrl: "", updatedAt: NOW,
  floors: [{ id: "ground", name: "一楼", floorplanName: "", floorplanDataUrl: "", imageWidth: 1, imageHeight: 1 }],
  points: [{
    id: "point-1", name: "Panel", room: "Living", code: "K01", floorId: "ground", iconId: "switch-3", status: "confirmed",
    x: 20, y: 30, placed: true, productId: PRODUCT_ID, deviceTypeId: "wall-switch", requirements: { button_count: 3, relay_count: 2, wiring: "neutral" }, usage: "selected", note: "",
    selection: { productId: PRODUCT_ID, mappingRevision: 2, deviceTypeId: "wall-switch", sku: "SYN-3N", name: "Synthetic switch", specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: [], capabilities: [], unit: "个", manufacturerModel: null, verifiedAt: NOW },
  }],
}

class PreviewClient {
  calls: string[] = []
  released = false
  constructor(readonly accessLevel = "edit", readonly visible = true) {}
  async query<T>(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()
    this.calls.push(normalized)
    let rows: unknown[] = []
    if (/^(begin|commit|rollback)/.test(normalized)) { /* read-only transaction */ }
    else if (normalized.includes("from projects p")) rows = this.visible ? [{ createdBy: USER_ID, accessLevel: this.accessLevel }] : []
    else if (normalized.includes("from project_point_map_designs")) rows = [{ plan: structuredClone(plan), revision: 4 }]
    else if (normalized.includes("from products")) rows = [structuredClone(product)]
    else if (normalized.includes("from project_product_prices")) rows = [{ product_id: PRODUCT_ID, unit_price: "350", cost_price: "225" }]
    else throw new Error(`Unexpected test query: ${normalized}`)
    return { rows: rows as T[], rowCount: rows.length }
  }
  release() { this.released = true }
}

const database = (client: PreviewClient) => ({ connect: async () => client }) as never
function account(role = "editor") {
  const context = buildAccountContext(
    { userId: USER_ID, name: "Synthetic member", role: "pro" },
    { id: USER_ID, account_type: "ENTERPRISE_MEMBER", account_status: "active", role: "pro" },
    { id: ORGANIZATION_ID, name: "Synthetic team", role: "editor" },
  )
  context.organization!.role = role
  return context
}

describe("point-map quote preview cost boundary", () => {
  it("keeps selling prices and source quantities but omits purchase costs for ordinary editors", async () => {
    const client = new PreviewClient()
    const result = await previewPointMapProcurement(account(), PROJECT_ID, 4, database(client))
    expect(result).toMatchObject({ blocked: false, included: 1, data: { projectId: PROJECT_ID, revision: 4, items: [{ price: 350, quantity: 1, pointIds: ["point-1"] }] } })
    expect(result.data.items[0]).not.toHaveProperty("cost")
    expect(client.calls.at(-1)).toBe("commit")
    expect(client.released).toBe(true)
    expect(product.cost).toBe(200)
  })

  it.each(["owner", "finance"])("preserves real costs in previews for %s", async (role) => {
    const result = await previewPointMapProcurement(account(role), PROJECT_ID, 4, database(new PreviewClient()))
    expect(result.data.items[0]).toMatchObject({ price: 350, cost: 200, quantity: 1 })
  })

  it("keeps complete server-only procurement data for quote saving", async () => {
    const result = await buildStoredProcurementPreview(new PreviewClient() as never, PROJECT_ID, 4)
    expect(result.data.items[0]).toMatchObject({ price: 350, cost: 200 })
  })

  it("still transfers a redacted preview to the quote page without restoring hidden costs", async () => {
    const preview = await previewPointMapProcurement(account(), PROJECT_ID, 4, database(new PreviewClient()))
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const result = await refreshPointMapQuote(PROJECT_ID, "Synthetic project", {
      expectedRevision: 4,
      fetcher: vi.fn(async () => new Response(JSON.stringify(preview))),
      publish: (snapshot) => writePointMapQuoteSnapshot(snapshot, storage),
    })
    expect(result).toMatchObject({ updated: true, included: 1 })
    expect(consumePointMapQuoteSnapshot(PROJECT_ID, storage)).toMatchObject({
      projectId: PROJECT_ID, revision: 4, items: [{ project: "Synthetic project", cost: 0, price: 350, quantity: 1, pointIds: ["point-1"] }],
    })
    expect(consumePointMapQuoteSnapshot(PROJECT_ID, storage)).toBeNull()
  })

  it.each([
    ["view", "active", "PROJECT_READ_ONLY"],
    ["edit", "expired", "SUBSCRIPTION_EXPIRED"],
  ] as const)("refuses %s membership with %s subscription before loading product costs", async (accessLevel, subscriptionStatus, code) => {
    const context = account()
    context.account.subscriptionStatus = subscriptionStatus
    const client = new PreviewClient(accessLevel)
    await expect(previewPointMapProcurement(context, PROJECT_ID, 4, database(client))).rejects.toMatchObject({ code, status: 403 })
    expect(client.calls.some((sql) => sql.includes("from products"))).toBe(false)
    expect(client.calls.at(-1)).toBe("rollback")
    expect(client.released).toBe(true)
  })
})
