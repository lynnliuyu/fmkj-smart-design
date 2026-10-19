-- Plan 020 additive schema. Safe to run repeatedly; no product values are inferred.
-- Rollback: after restoring a backup, drop the columns added below and device_types.
-- Do not drop product_snapshot after products have been edited: it protects old quotes.
CREATE TABLE IF NOT EXISTS device_types (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  default_icon_id text NOT NULL,
  allowed_icon_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  definition_version integer NOT NULL DEFAULT 1 CHECK (definition_version > 0),
  spec_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS catalog_kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS device_type_id text,
  ADD COLUMN IF NOT EXISTS parent_product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS manufacturer_model text,
  ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS protocols jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selection_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS selection_evidence text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS selection_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS selection_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pricing_evidence text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mapping_revision integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_selection_contract_check' AND conrelid = 'products'::regclass) THEN
    ALTER TABLE products ADD CONSTRAINT products_selection_contract_check CHECK (
      catalog_kind IN ('legacy', 'series', 'sku') AND
      selection_status IN ('pending', 'verified', 'conflict') AND
      pricing_status IN ('pending', 'verified', 'conflict') AND
      mapping_revision > 0 AND
      jsonb_typeof(specs) = 'object' AND jsonb_typeof(protocols) = 'array' AND jsonb_typeof(capabilities) = 'array' AND
      (parent_product_id IS NULL OR parent_product_id <> id)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS products_selection_queue_idx ON products (catalog_kind, selection_status, pricing_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_device_type_idx ON products(device_type_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_parent_product_idx ON products(parent_product_id) WHERE parent_product_id IS NOT NULL;
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS product_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS point_map_revision integer;
