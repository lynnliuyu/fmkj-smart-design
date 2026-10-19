-- Product moderation migration for fmkj_v3
-- Run via: pnpm db:migrate

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

UPDATE products
SET
  submitted_by = COALESCE(submitted_by, created_by),
  status = CASE
    WHEN status::text = 'active' THEN 'approved'
    WHEN status IS NULL THEN 'approved'
    ELSE status
  END
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_review_queue_idx
  ON products (status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_reviewer_idx
  ON products (reviewed_by, reviewed_at DESC)
  WHERE reviewed_by IS NOT NULL;
