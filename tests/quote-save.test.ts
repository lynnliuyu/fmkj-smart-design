import { describe, expect, it } from "vitest"

import { QuoteSaveError, saveQuoteDraft } from "../lib/quote-save.js"

type QueryCall = {
  params?: unknown[]
  sql: string
}

class FakeQuoteClient {
  readonly calls: QueryCall[] = []
  released = false

  constructor(private readonly options: { hasProject?: boolean; hasQuote?: boolean } = {}) {}

  async query<T>(sql: string, params?: unknown[]) {
    this.calls.push({ params, sql })
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rows: [] as T[] }
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
