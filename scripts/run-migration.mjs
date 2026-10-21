import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

// Legacy catalog rewrites are retired. Cleanup requires a reviewed change set.
export const migrationDefinitions = [
  ["neon-init.sql", "schema"],
  ["create-auth-tables.sql", "schema"],
  ["create-roles-table.sql", "schema"],
  ["create-activity-log-table.sql", "schema"],
  ["create-account-commerce-tables.sql", "schema"],
  ["create-project-workbench-fields.sql", "schema"],
  ["create-project-options.sql", "schema"],
  ["create-product-moderation-status-values.sql", "schema"],
  ["create-product-moderation-fields.sql", "schema"],
  ["create-platform-health-support.sql", "schema"],
  ["create-performance-indexes.sql", "schema"],
  ["create-project-site-photos.sql", "schema"],
  ["create-category-default-products.sql", "schema"],
  ["create-category-default-products-keycount.sql", "schema"],
  ["create-project-product-prices.sql", "schema"],
  ["create-work-orders.sql", "schema"],
  ["create-point-map-designs.sql", "schema"],
  ["create-product-selection.sql", "schema"],
  ["backfill-quote-product-snapshots.sql", "data"],
  ["create-product-catalog-constraints.sql", "schema"],
  ["normalize-product-categories.sql", "legacy-data"],
  ["normalize-product-platform-brand.sql", "legacy-data"],
  ["create-project-property-type.sql", "schema"],
  ["create-project-deliveries.sql", "schema"],
  ["create-product-visual-assets.sql", "schema"],
  ["create-project-category-default-products.sql", "schema"],
  ["drop-retired-modules.sql", "schema"],
].map(([id, kind]) => ({ id, kind, path: new URL(`./${id}`, import.meta.url) }))

// Only complete schema sentinels adopt historical migrations. A products table by
// itself is not proof that account, role, moderation or project setup has run.
export const existingSchemaSentinels = {
  "create-account-commerce-tables.sql": {
    account_profiles: "user_id account_type account_status organization_id created_at updated_at",
    plans: "id plan_code name billing_cycle price_cents currency limits is_active sort_order created_at updated_at",
    subscriptions: "id subject_type subject_id plan_id status starts_at ends_at grace_ends_at canceled_at created_at updated_at",
    orders: "id subject_type subject_id plan_id amount_cents currency status paid_at created_at updated_at",
    feature_flags: "key enabled description updated_by_user_id updated_at created_at",
    platform_settings: "key value updated_by_user_id updated_at created_at",
    organizations: "id name owner_user_id status created_at updated_at",
    organization_roles: "id organization_id code name is_system created_at updated_at",
    organization_role_permissions: "role_id permission_code created_at",
    organization_members: "id organization_id user_id role_id member_status created_at updated_at",
    project_members: "id project_id user_id access_level status created_at updated_at",
    projects: "owner_type owner_id transferred_from_user_id",
  },
  "create-roles-table.sql": {
    roles: "id key name description created_at updated_at deleted_at",
    users: "role_id",
  },
  "create-product-moderation-fields.sql": {
    products: "submitted_by reviewed_by reviewed_at review_note",
  },
  "create-project-workbench-fields.sql": {
    projects: "next_action_due_at next_action_owner_id next_action_owner_name waiting_on risk_level risk_reason",
  },
  "create-project-options.sql": {
    project_communities: "id name city district address status project_count last_used_at created_at updated_at deleted_at",
  },
}

function hasExistingSchema(migrationId, existingColumns) {
  const sentinel = existingSchemaSentinels[migrationId]
  return Boolean(sentinel) && Object.entries(sentinel).every(([table, columns]) =>
    columns.split(" ").every((column) => existingColumns.has(`${table}.${column}`)))
}

/** A connected pg client is injected so checks can run against an isolated database. */
export async function runMigrations(client, log = console.log) {
  const results = []
  await client.query("select pg_advisory_lock(hashtext('fmkj-schema-migrations'))")
  try {
    // Capture before bootstrap DDL: tables created during this run must not make
    // a fresh database look like a previously initialized installation.
    const sentinelTables = [...new Set(Object.values(existingSchemaSentinels).flatMap((sentinel) => Object.keys(sentinel)))]
    const catalog = await client.query("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])", [sentinelTables])
    const existingColumns = new Set(catalog.rows.map((row) => `${row.table_name}.${row.column_name}`))
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        checksum text not null,
        kind text not null,
        outcome text not null check (outcome in ('applied', 'skipped')),
        note text,
        applied_at timestamptz not null default now()
      )
    `)
    for (const migration of migrationDefinitions) {
      const sql = readFileSync(migration.path, "utf8")
      const checksum = createHash("sha256").update(sql).digest("hex")
      const previous = await client.query("select checksum, outcome from schema_migrations where id = $1", [migration.id])
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${migration.id}. Add a new migration instead of editing recorded SQL.`)
        results.push({ id: migration.id, outcome: "already-recorded" })
        continue
      }
      const retired = migration.kind === "legacy-data"
      const adopted = !retired && hasExistingSchema(migration.id, existingColumns)
      const skipped = retired || adopted
      const note = retired ? "Retired catalog normalizer: preserve brands, categories and reviewed selection data; use a reviewed product change set." : adopted ? "adopted-existing-schema: complete historical schema exists; preserve configured plans, roles and catalog/project data without replaying seeds." : null
      await client.query("begin")
      try {
        if (!skipped) await client.query(sql)
        await client.query("insert into schema_migrations (id, checksum, kind, outcome, note) values ($1, $2, $3, $4, $5)", [migration.id, checksum, migration.kind, skipped ? "skipped" : "applied", note])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      }
      const result = { id: migration.id, outcome: skipped ? "skipped" : "applied", ...(adopted ? { note: "adopted-existing-schema" } : {}) }
      results.push(result)
      log(`${result.outcome}: ${migration.id}${adopted ? " (adopted-existing-schema)" : ""}`)
    }
    return results
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('fmkj-schema-migrations'))")
  }
}

async function main() {
  loadLocalEnv()
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to run migrations.")
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } })
  await client.connect()
  try {
    const results = await runMigrations(client)
    console.log(`Migration complete: ${results.filter((row) => row.outcome === "applied").length} applied, ${results.filter((row) => row.outcome === "skipped").length} historical schema/retired normalizers preserved, ${results.filter((row) => row.outcome === "already-recorded").length} already recorded.`)
  } finally {
    await client.end()
  }
}

function loadLocalEnv() {
  const envPath = resolve(".env.local")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const index = trimmed.indexOf("=")
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "")
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
