-- 项目内统一换型不写全局默认；旧表保留追溯，不推断原设置的项目归属。
create table if not exists project_category_default_products (
  project_id uuid not null references projects(id),
  device_type_id text not null,
  button_count integer not null default 0 check (button_count between 0 and 4),
  product_id uuid not null references products(id),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (project_id, device_type_id, button_count)
);
