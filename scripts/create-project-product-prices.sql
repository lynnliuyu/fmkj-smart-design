-- 项目（客户）专属价格：同一商品在不同项目可有不同售价。报价保存时写入，同步报价时优先使用。
create table if not exists project_product_prices (
  project_id uuid not null references projects(id),
  product_id uuid not null references products(id),
  unit_price numeric(12,2) not null,
  cost_price numeric(12,2),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (project_id, product_id)
);
