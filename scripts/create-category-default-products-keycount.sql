-- 批量统一换型号按键数区分：button_count = 0 表示该类别全部键数，1–4 表示指定键数。
alter table category_default_products add column if not exists button_count integer not null default 0;
alter table category_default_products drop constraint if exists category_default_products_pkey;
alter table category_default_products add primary key (device_type_id, button_count);
