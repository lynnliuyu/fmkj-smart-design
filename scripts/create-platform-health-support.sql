-- Platform health support migration for fmkj_v3
-- Run via: pnpm db:migrate

CREATE INDEX IF NOT EXISTS activity_logs_actor_recent_idx
  ON activity_logs (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_logs_action_recent_idx
  ON activity_logs (action, occurred_at DESC);
