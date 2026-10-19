CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS project_communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  district TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  project_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS project_communities_active_name_idx
  ON project_communities (lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS project_communities_recent_idx
  ON project_communities (last_used_at DESC NULLS LAST, updated_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';

INSERT INTO project_communities (name, status, project_count, last_used_at)
SELECT community, 'active', count(*)::integer, max(updated_at)
FROM projects
WHERE nullif(trim(community), '') IS NOT NULL
  AND deleted_at IS NULL
GROUP BY community
ON CONFLICT (lower(name)) WHERE deleted_at IS NULL
DO UPDATE SET
  project_count = GREATEST(project_communities.project_count, excluded.project_count),
  last_used_at = GREATEST(
    COALESCE(project_communities.last_used_at, excluded.last_used_at),
    COALESCE(excluded.last_used_at, project_communities.last_used_at)
  ),
  updated_at = now();
