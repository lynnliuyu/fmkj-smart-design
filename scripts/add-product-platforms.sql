-- 生态平台由单值改多值（一个设备常同时支持米家 + Apple Home）。
--
-- 保留 products.platform 作为「首选平台」（= 多值的第一个），
-- 让快速报价、类目推断这些按单值工作的老逻辑不用改也能继续跑；
-- 新代码读 products.platforms。
alter table products add column if not exists platforms text[] not null default '{}';

-- 把现有单值搬进数组，并统一成英文记号（与 product-platforms.ts 的枚举一致）。
update products
set platforms = array[
  case lower(coalesce(platform, ''))
    when '米家' then 'mijia'
    when '小米' then 'mijia'
    when 'xiaomi' then 'mijia'
    when 'apple home' then 'homekit'
    when 'applehome' then 'homekit'
    when 'homekit' then 'homekit'
    when '华为' then 'huawei'
    when 'huawei' then 'huawei'
    when 'tuya' then 'tuya'
    when '涂鸦' then 'tuya'
    when 'knx' then 'knx'
    when 'alexa' then 'alexa'
    when 'google home' then 'google-home'
    when 'googlehome' then 'google-home'
    when '其他' then 'unlabeled'
    when '未标注' then 'unlabeled'
    when 'unlabeled' then 'unlabeled'
    else lower(coalesce(platform, ''))
  end
]
where coalesce(platform, '') <> ''
  and (platforms is null or platforms = '{}');

-- 首选平台 = 多值里的第一个（新写入由应用保证一致）。
update products
set platform = platforms[1]
where platforms <> '{}' and coalesce(platform, '') = '';

create index if not exists products_platforms_gin on products using gin (platforms);
