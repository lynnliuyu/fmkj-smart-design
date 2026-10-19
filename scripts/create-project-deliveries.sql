-- Immutable, project-scoped handover snapshots with frozen product photos.
-- Additive/repeatable. Revert application code to roll back without losing versions.
CREATE TABLE IF NOT EXISTS project_deliveries (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null check (version > 0),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot ?& ARRAY['id', 'version', 'project', 'plan', 'pointMapRevision', 'quote', 'products', 'changes', 'fingerprint', 'createdAt']
    and jsonb_typeof(snapshot->'project') = 'object'
    and snapshot->'project' ? 'id'
    and snapshot->'project'->>'id' = project_id::text
    and snapshot->>'id' = id::text
    and (snapshot->>'version')::integer = version
    and snapshot->>'fingerprint' = fingerprint
  ),
  -- Audit identity is retained without a mutable FK action on an immutable row.
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (project_id, version),
  unique (project_id, fingerprint)
);

CREATE OR REPLACE FUNCTION prevent_project_delivery_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PROJECT_DELIVERY_IMMUTABLE';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'project_deliveries_immutable'
      AND tgrelid = 'project_deliveries'::regclass
  ) THEN
    CREATE TRIGGER project_deliveries_immutable
      BEFORE UPDATE ON project_deliveries
      FOR EACH ROW EXECUTE FUNCTION prevent_project_delivery_update();
  END IF;
END;
$$;
