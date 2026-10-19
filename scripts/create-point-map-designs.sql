-- Project-scoped drafts and immutable confirmed point-map versions.
-- Additive and repeatable. Apply via the normal migration process.
-- Rollback: retain both tables and revert the application. Dropping either table
-- would discard customer designs and must be a separately reviewed migration.

CREATE TABLE IF NOT EXISTS project_point_map_designs (
  project_id uuid primary key references projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  plan jsonb not null check (
    jsonb_typeof(plan) = 'object' and plan ? 'projectId'
    and plan->>'projectId' = project_id::text
  ),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS project_point_map_versions (
  project_id uuid not null references projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  plan jsonb not null check (
    jsonb_typeof(plan) = 'object' and plan ? 'projectId'
    and plan->>'projectId' = project_id::text
  ),
  confirmed_by uuid,
  confirmed_at timestamptz not null default now(),
  primary key (project_id, revision)
);

-- Confirmed snapshots cannot be changed by later draft saves or accidental updates.
-- Deletion remains possible through the project's existing cascade lifecycle.
CREATE OR REPLACE FUNCTION prevent_point_map_version_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POINT_MAP_VERSION_IMMUTABLE';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'project_point_map_versions_immutable'
      AND tgrelid = 'project_point_map_versions'::regclass
  ) THEN
    CREATE TRIGGER project_point_map_versions_immutable
      BEFORE UPDATE ON project_point_map_versions
      FOR EACH ROW EXECUTE FUNCTION prevent_point_map_version_update();
  END IF;
END;
$$;

-- Track only items synchronized from physical point-map devices; manual items
-- keep a null origin so later synchronization cannot replace them accidentally.
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS point_map_project_id uuid references projects(id),
  ADD COLUMN IF NOT EXISTS point_ids jsonb not null default '[]'::jsonb;
