-- 苏米科技（SUMI）品牌纳入产品库白名单
-- 背景：苏米智控科技（苏州）有限公司（原苏州绿米智能科技有限公司）已接入米家生态，
--       属独立品牌，需加入 brand 白名单，否则 CHECK 约束会拒绝写入。

-- 1) 放宽 brand CHECK 约束，加入 苏米/SUMI
alter table products
  drop constraint if exists products_brand_whitelist_check;

alter table products
  add constraint products_brand_whitelist_check
  check (
    brand ISNULL OR brand IN (
      '领普/Linptech', '平头熊/PTX', '易来/yeelight', '鹿客', '中弘',
      'Aqara', '小米/xiaomi', '锐捷/Ruijie', '金闪', '苏米/SUMI', '其他'
    )
  ) NOT VALID;

-- 2) 历史脏数据归一：如果此前有人用「苏米」裸字符串入库，统一到白名单写法
update products
set brand = '苏米/SUMI',
    updated_at = now()
where deleted_at is null
  and brand is not null
  and brand <> '其他'
  and (brand like '%苏米%' or lower(brand) like '%sumi%');

-- 3) 确认 platform 合法（苏米全线已接入米家，platform 应为「米家」）
update products
set platform = '米家',
    updated_at = now()
where deleted_at is null
  and brand = '苏米/SUMI'
  and (platform is null or platform <> '米家');

-- 4) 确认 category 落在标准分类白名单内
update products
set category = '其他',
    updated_at = now()
where deleted_at is null
  and brand = '苏米/SUMI'
  and category not in (
    '监控', '门锁', '传感器', '窗帘', '开关', '插座',
    '暖通控制', '网关中控', '全屋wifi', '智能灯具', '普通灯具', '其他'
  );

-- 5) 校验：导入后应能正常查询
select brand, category, count(*)::int as n
from products
where deleted_at is null and brand = '苏米/SUMI'
group by brand, category
order by n desc;
