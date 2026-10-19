import { describe, expect, it } from "vitest"
import { existingSchemaSentinels, migrationDefinitions, runMigrations } from "../scripts/run-migration.mjs"
import { isProtectedProduct, legacyProductUpdatePredicate, prepareLegacyProductImport } from "../scripts/import-product-safety.mjs"

type LedgerRow = { checksum: string; outcome: string }
class MigrationClient {
  readonly queries: string[] = []
  readonly ledger = new Map<string, LedgerRow>()
  failOn = ""
  columns: Array<{ table_name: string; column_name: string }> = []
  async query(sql: string, params: unknown[] = []) {
    this.queries.push(sql)
    if (sql.startsWith("select table_name, column_name")) return { rows: this.columns }
    if (this.failOn && sql.includes(this.failOn)) throw new Error("synthetic migration failure")
    if (sql.startsWith("select checksum, outcome")) return { rows: this.ledger.has(String(params[0])) ? [this.ledger.get(String(params[0]))] : [] }
    if (sql.startsWith("insert into schema_migrations")) this.ledger.set(String(params[0]), { checksum: String(params[1]), outcome: String(params[3]) })
    return { rows: [] }
  }
}

describe("migration ledger safety", () => {
  it("never runs retired catalog rewrites, including on the first migration run", async () => {
    const client = new MigrationClient()
    const result = await runMigrations(client, () => {})
    expect(result.filter((row: { outcome: string }) => row.outcome === "skipped").map((row: { id: string }) => row.id)).toEqual(["normalize-product-categories.sql", "normalize-product-platform-brand.sql"])
    expect(client.queries.some((sql) => sql.includes("WHEN brand IN ('易来', 'Yeelight')"))).toBe(false)
    expect(client.queries.some((sql) => sql.includes("concat_ws(' ', category, name, brand, platform, description, sku)"))).toBe(false)
    expect(client.ledger.size).toBe(migrationDefinitions.length)
    expect(client.queries.findIndex((sql) => sql.includes("SET product_snapshot = jsonb_build_object"))).toBeGreaterThan(client.queries.findIndex((sql) => sql.includes("CREATE TABLE IF NOT EXISTS device_types")))
  })

  it("adopts complete existing account, role, moderation and project schemas without replaying seed data", async () => {
    const client = new MigrationClient()
    client.columns = Object.values(existingSchemaSentinels).flatMap((sentinel) => Object.entries(sentinel).flatMap(([table_name, columns]) => columns.split(" ").map((column_name) => ({ table_name, column_name }))))
    const result = await runMigrations(client, () => {})
    for (const id of Object.keys(existingSchemaSentinels)) expect(result.find((row: { id: string }) => row.id === id)).toMatchObject({ outcome: "skipped", note: "adopted-existing-schema" })
    expect(client.queries.some((sql) => sql.includes("ON CONFLICT (plan_code) DO UPDATE"))).toBe(false)
    expect(client.queries.some((sql) => sql.includes("INSERT INTO roles"))).toBe(false)
    expect(client.queries.some((sql) => sql.includes("submitted_by = COALESCE"))).toBe(false)
  })

  it("does not mistake a partial account schema for a completed installation", async () => {
    const client = new MigrationClient()
    client.columns = [{ table_name: "plans", column_name: "id" }]
    const result = await runMigrations(client, () => {})
    expect(result.find((row: { id: string }) => row.id === "create-account-commerce-tables.sql")).toMatchObject({ outcome: "applied" })
  })

  it("does not repeat already applied schema, quote capture or seed mutations", async () => {
    const client = new MigrationClient()
    await runMigrations(client, () => {})
    client.queries.length = 0
    const result = await runMigrations(client, () => {})
    expect(result.every((row: { outcome: string }) => row.outcome === "already-recorded")).toBe(true)
    expect(client.queries.some((sql) => sql.includes("SET product_snapshot"))).toBe(false)
    expect(client.queries.some((sql) => sql.includes("INSERT INTO roles"))).toBe(false)
    expect(client.queries.filter((sql) => sql === "begin")).toHaveLength(0)
  })

  it("rejects modified recorded SQL and releases the migration lock", async () => {
    const client = new MigrationClient()
    client.ledger.set(migrationDefinitions[0].id, { checksum: "modified-source", outcome: "applied" })
    await expect(runMigrations(client, () => {})).rejects.toThrow("Applied migration changed")
    expect(client.queries.at(-1)).toContain("pg_advisory_unlock")
  })

  it("rolls back a failed migration without recording success", async () => {
    const client = new MigrationClient()
    client.failOn = "-- FMKJ v3 Neon bootstrap schema."
    await expect(runMigrations(client, () => {})).rejects.toThrow("synthetic migration failure")
    expect(client.queries).toContain("rollback")
    expect(client.ledger.size).toBe(0)
    expect(client.queries.at(-1)).toContain("pg_advisory_unlock")
  })
})

describe("legacy import safety", () => {
  it.each([
    { catalog_kind: "sku", selection_status: "pending" },
    { catalog_kind: "series" },
    { selection_status: "verified" },
    { selection_status: "conflict" },
    { pricing_status: "verified" },
    { catalogKind: "sku", selectionStatus: "verified" },
  ])("protects edited classification, parameters or prices against old importers: %o", (product) => {
    expect(isProtectedProduct(product)).toBe(true)
  })

  it("allows only untouched legacy/pending rows to receive old import data", () => {
    expect(isProtectedProduct({})).toBe(false)
    expect(isProtectedProduct({ catalog_kind: "legacy", selection_status: "pending", pricing_status: "pending" })).toBe(false)
    expect(legacyProductUpdatePredicate("p")).toContain("to_jsonb(p)->>'catalog_kind'")
    expect(() => legacyProductUpdatePredicate("products; delete from products")).toThrow()
  })

  it("refuses product updates if existing quote displays cannot yet be frozen", async () => {
    const queries: string[] = []
    const client = { query: async (sql: string) => {
      queries.push(sql)
      if (sql.includes("to_regclass")) return { rows: [{ quote_items: "quote_items" }] }
      if (sql.includes("information_schema")) return { rows: [] }
      return { rows: [{ id: "old-quote-item" }] }
    } }
    await expect(prepareLegacyProductImport(client)).rejects.toThrow("Run db:migrate")
    expect(queries.some((sql) => /update|insert/i.test(sql))).toBe(false)
  })

  it("captures only missing quote snapshots before an importer may update display fields", async () => {
    const queries: string[] = []
    const client = { query: async (sql: string) => {
      queries.push(sql)
      if (sql.includes("to_regclass")) return { rows: [{ quote_items: "quote_items" }] }
      return { rows: [{ present: true }] }
    } }
    await prepareLegacyProductImport(client)
    expect(queries.at(-1)).toContain("qi.product_snapshot IS NULL")
    expect(queries.at(-1)).not.toContain("unit_price =")
  })
})
