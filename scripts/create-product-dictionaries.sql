-- 品牌 / 系列 / 型号 受控字典（2026-10-23 决定：这三个字段不再自由填写）。
--
-- 为什么建表而不是写死在代码里：品牌和型号会一直新增，运营方要能在后台自己加，
-- 不该每次都找我改代码发版。产品表里仍然存文本（brand / series / manufacturer_model），
-- 字典只负责「允许填什么」，这样已有数据和查询都不用改。

create table if not exists product_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_series (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references product_brands(id) on delete cascade,
  name text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table if not exists product_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references product_brands(id) on delete cascade,
  series_id uuid references product_series(id) on delete set null,
  name text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, name)
);

-- 系列是产品上的新字段（以前没有）；先允许为空，整理时逐步补。
alter table products add column if not exists series text;

create index if not exists product_series_brand_idx on product_series (brand_id);
create index if not exists product_models_brand_idx on product_models (brand_id);
create index if not exists product_models_series_idx on product_models (series_id);
create index if not exists products_series_idx on products (series);

-- 种子 1：现有品牌收进字典（保留现有写法，不擅自改名）
insert into product_brands (name)
select distinct btrim(brand)
from products
where deleted_at is null and btrim(coalesce(brand, '')) <> ''
on conflict (name) do nothing;

-- 种子 2：现有厂家型号按品牌归组（没有品牌的型号先不收，避免挂错品牌）
insert into product_models (brand_id, name)
select b.id, btrim(p.manufacturer_model)
from products p
join product_brands b on b.name = btrim(p.brand)
where p.deleted_at is null and btrim(coalesce(p.manufacturer_model, '')) <> ''
group by b.id, btrim(p.manufacturer_model)
on conflict (brand_id, name) do nothing;
