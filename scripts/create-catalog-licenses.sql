-- 一机一密：每个客户设备一个取资料凭据（2026-10-23）。
--
-- 为什么不再共用一个令牌：令牌一旦泄露（客户截图、日志、转卖），所有设备的产品库都暴露，
-- 而且分不清是谁在取。改成一台设备一个凭据：单独停用某台的、能看到谁在用、泄露只影响一台。
--
-- 库里只存哈希与前缀，不存明文：数据库备份泄露也不能直接拿去取资料。
-- 明文只在创建时给运营方一次，由他填进设备。
create table if not exists catalog_licenses (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  key_prefix text not null,
  label text not null,
  enabled boolean not null default true,
  instance_id text,
  last_seen_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_licenses_enabled_idx on catalog_licenses (enabled);
create index if not exists catalog_licenses_last_seen_idx on catalog_licenses (last_seen_at desc);
