-- Activity log migration for fmkj_v3
-- Run via: pnpm db:migrate

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  actor_id UUID,
  actor_name TEXT,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_label TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_logs_recent_idx
  ON activity_logs (occurred_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_logs_entity_idx
  ON activity_logs (entity_type, entity_id, occurred_at DESC);
