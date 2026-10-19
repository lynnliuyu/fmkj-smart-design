-- Project workbench fields for priority grouping and command-center UI.
-- Run via: pnpm db:migrate

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS next_action_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_action_owner_id UUID,
  ADD COLUMN IF NOT EXISTS next_action_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS waiting_on TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS risk_reason TEXT;

UPDATE projects
SET
  waiting_on = COALESCE(NULLIF(waiting_on, ''), 'none'),
  risk_level = CASE
    WHEN risk_level IN ('normal', 'watch', 'blocked') THEN risk_level
    WHEN status_tone::text = 'error' THEN 'blocked'
    WHEN status_tone::text = 'warn' THEN 'watch'
    ELSE 'normal'
  END,
  next_action_owner_name = COALESCE(NULLIF(next_action_owner_name, ''), NULLIF(owner, ''))
WHERE waiting_on IS NULL
   OR waiting_on = ''
   OR risk_level IS NULL
   OR risk_level = ''
   OR next_action_owner_name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_waiting_on_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_waiting_on_check
      CHECK (waiting_on IN ('none', 'customer', 'internal', 'vendor'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_risk_level_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_risk_level_check
      CHECK (risk_level IN ('normal', 'watch', 'blocked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_workbench_due_idx
  ON projects (next_action_due_at, updated_at DESC)
  WHERE deleted_at IS NULL AND status <> 'archived';

CREATE INDEX IF NOT EXISTS projects_workbench_risk_idx
  ON projects (risk_level, next_action_due_at, updated_at DESC)
  WHERE deleted_at IS NULL AND status <> 'archived' AND risk_level <> 'normal';

CREATE INDEX IF NOT EXISTS projects_workbench_waiting_idx
  ON projects (waiting_on, updated_at DESC)
  WHERE deleted_at IS NULL AND status <> 'archived' AND waiting_on <> 'none';
