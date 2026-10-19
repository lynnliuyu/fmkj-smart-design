-- 项目现场图片库
-- Run via: pnpm db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'site_photo_category') THEN
    CREATE TYPE site_photo_category AS ENUM (
      'site_entry',
      'construction',
      'concealed',
      'acceptance',
      'other'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  blob_url text not null,
  blob_pathname text,
  thumbnail_url text,
  file_name text not null,
  content_type text,
  size_bytes integer,
  category site_photo_category not null default 'other',
  notes text,
  taken_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'project_site_photos_project_created_idx'
  ) THEN
    CREATE INDEX project_site_photos_project_created_idx
      ON project_site_photos (project_id, created_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
END $$;