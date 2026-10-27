import { describe, expect, it } from "vitest"

import { buildAccountContext } from "../lib/account-context.js"
import { QuoteSaveError, saveQuoteDraft } from "../lib/quote-save.js"

type QueryCall = {
  params?: unknown[]
  sql: string
}

class FakeQuoteClient {
  readonly calls: QueryCall[] = []
  released = false

  constructor(private readonly options: { hasProject?: boolean; hasQuote?: boolean; catalogCost?: number; projectCost?: number; savedCost?: number } = {}) {}

  async query<T>(sql: string, params?: unknown[]) {
    this.calls.push({ params, sql })
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rows: [] as T[] }
    }

    if (normalized.includes("coalesce(cost, 0)::float8 as cost from products")) {
      return {
        rows: this.options.catalogCost === undefined ? [] : [{ id: "44444444-4444-4444-8444-444444444444", cost: this.options.catalogCost }],
      }
    }

    if (normalized.includes("from project_product_prices")) {
      return { rows: this.options.projectCost === undefined ? [] : [{ product_id: "44444444-4444-4444-8444-444444444444", cost_price: this.options.projectCost }] }
    }

    if (normalized.includes("from quote_items")) {
      return { rows: this.options.savedCost === undefined ? [] : [{ product_id: "44444444-4444-4444-8444-444444444444", room: "Living", cost_price: this.options.savedCost, product_snapshot: {} }] }
    }

    if (normalized.includes("from projects")) {
      return {
        rows:
          this.options.hasProject === false
            ? []
            : [
                {
                  createdAt: new Date("2026-06-28T09:00:00.000Z"),
                  id: "11111111-1111-4111-8111-111111111111",
                  name: "Demo Project",
                  createdBy: "11111111-1111-4111-8111-111111111111",
                  accessLevel: "edit",
                },
              ],
      }
    }

    if (normalized.includes("from quotes")) {
      return {
        rows: this.options.hasQuote
          ? [{ id: "22222222-2222-4222-8222-222222222222", quote_no: "QT-EXISTING" }]
          : [],
      }
    }

    if (normalized.includes("insert into quotes") || normalized.includes("update quotes")) {
      return { rows: [{ id: "33333333-3333-4333-8333-333333333333", quote_no: "QT-TEST" }] }
    }

    if (normalized.includes("insert into activity_logs")) {
      return { rows: [{ id: "activity_1" }] }
    }

    return { rows: [] as T[] }
  }

  release() {
    this.released = true
  }
}

class FakeQuotePool {
  constructor(readonly client: FakeQuoteClient) {}

  async connect() {
    return this.client
  }
}

describe("quote save module", () => {
  it("calculates total cost from the same rounded unit cost stored on each line", async () => {
    const client = new FakeQuoteClient()
    await saveQuoteDraft({
      projectId: "11111111-1111-4111-8111-111111111111",
      items: [{ cost: 0.335, discount: 100, name: "Fractional cost", price: 3, productId: "44444444-4444-4444-8444-444444444444", quantity: 3, room: "Living", spec: "", unit: "pc" }],
    }, { db: new FakeQuotePool(client) as never })
    expect(client.calls.find((call) => call.sql.toLowerCase().includes("insert into quotes"))?.params?.[7]).toBe(1.02)
    expect(client.calls.find((call) => call.sql.toLowerCase().includes("insert into quote_items"))?.params?.[10]).toBe(0.34)
  })
  it.each([
    { savedCost: 125, projectCost: 150, expected: 125 },
    { projectCost: 150, expected: 150 },
    { projectCost: 0, expected: 0 },
  ])("preserves stored project costs for a member who cannot see costs: %j", async ({ expected, ...costs }) => {
    const client = new FakeQuoteClient({ hasQuote: true, catalogCost: 200, ...costs })
    const editor = buildAccountContext(
      { userId: "11111111-1111-4111-8111-111111111111", name: "Editor", role: "editor" },
      { id: "11111111-1111-4111-8111-111111111111", role: "editor", status: "active" },
      { id: "99999999-9999-4999-8999-999999999999", name: "Team", role: "editor" },
    )
    await saveQuoteDraft({
      projectId: "11111111-1111-4111-8111-111111111111",
      items: [{ cost: 0, discount: 100, name: "Hidden cost", price: 300, productId: "44444444-4444-4444-8444-444444444444", quantity: 2, room: "Living", spec: "", unit: "pc" }],
    }, { context: editor, db: new FakeQuotePool(client) as never })
    expect(client.calls.find((call) => call.sql.toLowerCase().includes("update quotes"))?.params?.[6]).toBe(expected * 2)
    expect(client.calls.find((call) => call.sql.toLowerCase().includes("insert into quote_items"))?.params?.[10]).toBe(expected)
  })
  it("owns the transaction and saves a draft quote behind one interface", async () => {
    const client = new FakeQuoteClient()
    const result = await saveQuoteDraft(
      {
        discount: 100,
        installationFee: 500,
        items: [
          {
            cost: 100,
            discount: 90,
            name: "Panel AP",
            price: 300,
            productId: "44444444-4444-4444-8444-444444444444",
            quantity: 2,
            room: "Living",
            spec: "PoE",
            unit: "pc",
          },
          {
            cost: 1,
            discount: 100,
            name: "Invalid",
            price: 1,
            productId: "not-a-uuid",
            quantity: 1,
            room: "Living",
            spec: "",
            unit: "pc",
          },
        ],
        projectId: "11111111-1111-4111-8111-111111111111",
        rooms: [" Living ", ""],
        subtotal: 600,
        total: 1040,
      },
      {
        createQuoteNo: () => "QT-TEST",
        db: new FakeQuotePool(client) as never,
        now: () => new Date("2026-06-28T11:00:00.000Z"),
      },
    )

    expect(result).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      quoteNo: "QT-TEST",
      savedItems: 1,
      skippedItems: 1,
    })
    expect(client.calls.map((call) => call.sql.trim().toLowerCase())).toContain("begin")
    expect(client.calls.map((call) => call.sql.trim().toLowerCase())).toContain("commit")
    expect(client.released).toBe(true)
    expect(client.calls.some((call) => call.sql.includes("insert into quote_items"))).toBe(true)
    expect(client.calls.some((call) => call.sql.includes("update projects"))).toBe(true)
  })

  it("keeps an explicit zero cost instead of falling back to the catalogue", async () => {
    const client = new FakeQuoteClient({ catalogCost: 200 })
    await saveQuoteDraft(
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        items: [{ cost: 0, discount: 100, name: "Zero cost", price: 300, productId: "44444444-4444-4444-8444-444444444444", quantity: 2, room: "Living", spec: "", unit: "pc" }],
      },
      { createQuoteNo: () => "QT-ZERO", db: new FakeQuotePool(client) as never },
    )
    const quoteInsert = client.calls.find((call) => call.sql.toLowerCase().includes("insert into quotes"))
    const itemInsert = client.calls.find((call) => call.sql.toLowerCase().includes("insert into quote_items"))
    expect(quoteInsert?.params?.[7]).toBe(0)
    expect(itemInsert?.params?.[10]).toBe(0)
  })

  it("ignores a hidden member's zero placeholder and uses the catalogue cost", async () => {
    const client = new FakeQuoteClient({ catalogCost: 200 })
    const editor = buildAccountContext(
      { userId: "11111111-1111-4111-8111-111111111111", name: "Editor", role: "member" },
      { id: "11111111-1111-4111-8111-111111111111", account_type: "ENTERPRISE_MEMBER", account_status: "active", role: "member" },
      { id: "99999999-9999-4999-8999-999999999999", name: "Team", role: "editor" },
    )
    await saveQuoteDraft(
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        items: [{ cost: 0, discount: 100, name: "Hidden cost", price: 300, productId: "44444444-4444-4444-8444-444444444444", quantity: 2, room: "Living", spec: "", unit: "pc" }],
      },
      { context: editor, createQuoteNo: () => "QT-HIDDEN", db: new FakeQuotePool(client) as never },
    )
    const quoteInsert = client.calls.find((call) => call.sql.toLowerCase().includes("insert into quotes"))
    const itemInsert = client.calls.find((call) => call.sql.toLowerCase().includes("insert into quote_items"))
    expect(quoteInsert?.params?.[7]).toBe(400)
    expect(itemInsert?.params?.[10]).toBe(200)
  })

  it("rolls back when the target project cannot be resolved", async () => {
    const client = new FakeQuoteClient({ hasProject: false })

    await expect(
      saveQuoteDraft(
        { projectId: "11111111-1111-4111-8111-111111111111" },
        { db: new FakeQuotePool(client) as never },
      ),
    ).rejects.toMatchObject(new QuoteSaveError("PROJECT_NOT_FOUND", 404))

    expect(client.calls.map((call) => call.sql.trim().toLowerCase())).toContain("rollback")
    expect(client.released).toBe(true)
  })
})
