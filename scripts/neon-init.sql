-- FMKJ v3 Neon bootstrap schema.
-- Run this once in Neon SQL Editor, or with:
-- psql "$DATABASE_URL" -f scripts/neon-init.sql

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_stage') then
    create type project_stage as enum (
      'new',
      'measure',
      'proposal',
      'contract',
      'install',
      'acceptance',
      'aftercare'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_status_tone') then
    create type project_status_tone as enum ('info', 'success', 'warn', 'error');
  end if;
end $$;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  updated_by uuid,
  name text not null,
  brand text,
  platform text,
  category text,
  sku text not null unique,
  unit text not null default '个',
  price numeric(12, 2) not null default 0,
  cost numeric(12, 2) not null default 0,
  stock integer not null default 0,
  image text,
  description text,
  tags jsonb not null default '[]'::jsonb,
  channels jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  updated_by uuid,
  status text not null default 'draft',
  name text not null,
  code text not null unique,
  client_name text,
  customer_name text,
  phone text,
  community text,
  building text,
  room_no text,
  platform text,
  owner text,
  designer text,
  budget numeric(12, 2) not null default 0,
  quote_no text,
  quote_amount numeric(12, 2),
  stage project_stage not null default 'new',
  stage_label text,
  status_tone project_status_tone not null default 'info',
  progress integer not null default 0,
  due_note text,
  next_action text,
  next_action_due_at timestamptz,
  next_action_owner_id uuid,
  next_action_owner_name text,
  waiting_on text not null default 'none' check (waiting_on in ('none', 'customer', 'internal', 'vendor')),
  risk_level text not null default 'normal' check (risk_level in ('normal', 'watch', 'blocked')),
  risk_reason text,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists project_communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  district text,
  address text,
  status text not null default 'active',
  project_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  updated_by uuid,
  status text not null default 'draft',
  project_id uuid not null references projects(id) on delete cascade,
  quote_no text not null unique,
  title text not null,
  version integer not null default 1,
  subtotal_amount numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  cost_amount numeric(12, 2) not null default 0,
  gross_margin_amount numeric(12, 2) not null default 0,
  gross_margin_rate numeric(8, 4) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  updated_by uuid,
  status text not null default 'active',
  quote_id uuid not null references quotes(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  room text,
  name text,
  unit text,
  final_unit_price numeric(12, 2) not null default 0,
  cost_price numeric(12, 2) not null default 0,
  subtotal_amount numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists project_attachments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  file_name text not null,
  file_url text not null,
  content_type text,
  size_bytes bigint not null default 0
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  actor_name text,
  entity_type text not null,
  entity_id uuid,
  entity_label text not null,
  action text not null,
  title text not null,
  description text not null,
  occurred_at timestamptz not null default now(),
  duration_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists platform_settings (
  key text primary key,
  value text not null default '',
  updated_by_user_id uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists products_active_idx on products (status, deleted_at);
create index if not exists products_category_idx on products (category);
create index if not exists projects_active_idx on projects (status, deleted_at, updated_at desc);
create unique index if not exists project_communities_active_name_idx
  on project_communities (lower(name))
  where deleted_at is null;
create index if not exists project_communities_recent_idx
  on project_communities (last_used_at desc nulls last, updated_at desc)
  where deleted_at is null and status = 'active';
create index if not exists projects_workbench_due_idx
  on projects (next_action_due_at, updated_at desc)
  where deleted_at is null and status <> 'archived';
create index if not exists projects_workbench_risk_idx
  on projects (risk_level, next_action_due_at, updated_at desc)
  where deleted_at is null and status <> 'archived' and risk_level <> 'normal';
create index if not exists projects_workbench_waiting_idx
  on projects (waiting_on, updated_at desc)
  where deleted_at is null and status <> 'archived' and waiting_on <> 'none';
create index if not exists quotes_project_idx on quotes (project_id, status, deleted_at, updated_at desc);
create index if not exists quote_items_quote_idx on quote_items (quote_id, sort_order, created_at);
create index if not exists project_attachments_project_idx
  on project_attachments (project_id, kind, created_at desc)
  where deleted_at is null;
create index if not exists activity_logs_recent_idx
  on activity_logs (occurred_at desc, created_at desc);
create index if not exists activity_logs_entity_idx
  on activity_logs (entity_type, entity_id, occurred_at desc);
create index if not exists platform_settings_updated_idx
  on platform_settings (updated_at desc);
