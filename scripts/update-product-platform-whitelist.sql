-- 生态平台改多值后，单选列 platform 的允许值也要跟着更新（2026-10-23）。
--
-- 原白名单来自 normalize-product-platform-brand.sql，只允许 米家/绿米/华为/Apple Home/Google Home/knx/tuya/其他。
-- 现在「其他」的语义改成「未标注」，且值统一用 product-platforms.ts 里的中文标签（Tuya、KNX 大小写统一），
-- 所以 371 条产品的整理写入会被旧白名单拦下（实测）。
--
-- 保留旧写法（绿米、其他、knx、tuya）以免历史数据被判非法——约束仍是 NOT VALID，
-- 只约束新写入，不回头校验老数据。
alter table products drop constraint if exists products_platform_whitelist_check;

alter table products add constraint products_platform_whitelist_check
  check (
    platform is null or platform = any (array[
      '米家', 'Apple Home', '华为', 'Tuya', 'KNX', 'Amazon Alexa', 'Google Home', '未标注',
      -- 历史写法，保留兼容
      '绿米', '其他', 'tuya', 'knx', 'google home', 'alexa'
    ]::text[])
  ) not valid;
