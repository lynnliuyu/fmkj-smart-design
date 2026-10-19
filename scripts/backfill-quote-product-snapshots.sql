-- Run only after create-product-selection.sql, before any product cleanup.
-- Freeze the currently displayed values, not a claim about original issue-time data.
-- Existing snapshots, monetary values and quote revisions are never rewritten.
UPDATE quote_items qi
SET product_snapshot = jsonb_build_object(
  'version', 1,
  'origin', 'legacy-migration',
  'capturedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'name', coalesce(qi.name, p.name),
  'sku', p.sku,
  'spec', coalesce(qi.note, p.description, p.sku),
  'unit', coalesce(qi.unit, p.unit, '个'),
  'category', p.category,
  'image', p.image
)
FROM products p
WHERE qi.product_id = p.id AND qi.product_snapshot IS NULL;
