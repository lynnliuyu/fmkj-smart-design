-- Product moderation status values for databases where products.status is active_status.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'active_status') THEN
    ALTER TYPE active_status ADD VALUE IF NOT EXISTS 'approved';
    ALTER TYPE active_status ADD VALUE IF NOT EXISTS 'pending_review';
    ALTER TYPE active_status ADD VALUE IF NOT EXISTS 'rejected';
  END IF;
END $$;
