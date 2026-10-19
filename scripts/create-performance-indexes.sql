-- Performance support indexes for frequently visited dashboard pages.
-- Run via: pnpm db:migrate

CREATE INDEX IF NOT EXISTS projects_contracts_idx
  ON projects (updated_at DESC, created_at DESC)
  WHERE deleted_at IS NULL AND status <> 'archived';

CREATE INDEX IF NOT EXISTS organizations_recent_idx
  ON organizations (updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS subscriptions_subject_status_idx
  ON subscriptions (subject_type, subject_id, status);

CREATE INDEX IF NOT EXISTS organization_members_count_idx
  ON organization_members (organization_id, member_status);
