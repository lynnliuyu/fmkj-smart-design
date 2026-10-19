-- 品类统一采用的默认产品（同步报价时未指定产品的点位使用）。
-- 修改只影响之后的点位同步；已保存的报价行不会被自动改写。
create table if not exists category_default_products (
  device_type_id text primary key,
  product_id uuid not null references products(id),
  updated_at timestamptz not null default now(),
  updated_by text
);
