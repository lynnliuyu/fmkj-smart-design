-- Reusable display derivatives. No original product or quote snapshots are rewritten.
CREATE TABLE IF NOT EXISTS product_visual_assets (
  product_id uuid PRIMARY KEY REFERENCES products(id),
  image text NOT NULL CHECK (length(image) BETWEEN 1 AND 4096),
  source_image text NOT NULL CHECK (length(source_image) BETWEEN 1 AND 4096),
  crop jsonb,
  scale numeric NOT NULL DEFAULT 1 CHECK (scale BETWEEN 0.5 AND 2),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'series', 'verified')),
  evidence text NOT NULL DEFAULT '' CHECK (length(evidence) <= 4000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_visual_assets_crop_check CHECK (
    crop IS NULL OR (
      jsonb_typeof(crop) = 'object' AND
      crop ?& ARRAY['x', 'y', 'width', 'height'] AND
      jsonb_typeof(crop->'x') = 'number' AND jsonb_typeof(crop->'y') = 'number' AND
      jsonb_typeof(crop->'width') = 'number' AND jsonb_typeof(crop->'height') = 'number' AND
      (crop->>'x')::numeric >= 0 AND (crop->>'y')::numeric >= 0 AND
      (crop->>'width')::numeric > 0 AND (crop->>'height')::numeric > 0 AND
      (crop->>'x')::numeric + (crop->>'width')::numeric <= 1.000000001 AND
      (crop->>'y')::numeric + (crop->>'height')::numeric <= 1.000000001
    )
  )
);
CREATE INDEX IF NOT EXISTS product_visual_assets_review_idx ON product_visual_assets (review_status, updated_at DESC);
