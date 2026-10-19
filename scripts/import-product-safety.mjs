import { readFileSync } from "node:fs"

/** to_jsonb also works before the additive selection columns exist. */
export function legacyProductUpdatePredicate(alias = "products") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid product table alias")
  return `coalesce(to_jsonb(${alias})->>'catalog_kind', 'legacy') = 'legacy'
    and coalesce(to_jsonb(${alias})->>'selection_status', 'pending') = 'pending'
    and coalesce(to_jsonb(${alias})->>'pricing_status', 'pending') = 'pending'`
}

export function isProtectedProduct(product) {
  return (product.catalog_kind ?? product.catalogKind ?? "legacy") !== "legacy" ||
    (product.selection_status ?? product.selectionStatus ?? "pending") !== "pending" ||
    (product.pricing_status ?? product.pricingStatus ?? "pending") !== "pending"
}

/** Freeze quote displays before a legacy importer changes product display fields. */
export async function prepareLegacyProductImport(client) {
  const relation = await client.query("select to_regclass('public.quote_items') as quote_items")
  if (!relation.rows[0]?.quote_items) return
  const column = await client.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_items' and column_name = 'product_snapshot'")
  if (!column.rows.length) {
    const existing = await client.query("select 1 from quote_items limit 1")
    if (existing.rows.length) throw new Error("Existing quotes need frozen product snapshots. Run db:migrate before importing product updates.")
    return
  }
  await client.query(readFileSync(new URL("./backfill-quote-product-snapshots.sql", import.meta.url), "utf8"))
}
