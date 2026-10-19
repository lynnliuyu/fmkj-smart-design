update products
set category = case
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(监控|摄像|camera|ipc|nvr)' then '监控'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(门锁|智能锁|指纹锁|door lock|lock|门禁)' then '门锁'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(传感|人体|存在|温湿度|温度|湿度|烟雾|烟感|水浸|漏水|门磁|pir|sensor)' then '传感器'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(窗帘|卷帘|电机|curtain)' then '窗帘'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(插座|地插|usb插|socket|outlet)' then '插座'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(暖通|空调|温控|新风|地暖|vrf|风机盘管|多联机|hvac)' then '暖通控制'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(wifi|wi-fi|无线|ap|mesh|路由|交换机|网络覆盖|poe|网口)' then '全屋wifi'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(网关|中控|妙控|智能面板|控制屏|hub|gateway|panel)' then '网关中控'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(开关|场景|调光|回路|switch|dimmer)' then '开关'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(智能灯|灯带|筒灯|射灯|轨道灯|磁吸灯|智能照明)' then '智能灯具'
  when concat_ws(' ', category, name, brand, platform, description, sku) ~* '(普通灯|吊灯|壁灯|吸顶灯|普通照明)' then '普通灯具'
  else '其他'
end
where category is null
   or category not in (
    '监控',
    '门锁',
    '传感器',
    '窗帘',
    '开关',
    '插座',
    '暖通控制',
    '网关中控',
    '全屋wifi',
    '智能灯具',
    '普通灯具',
    '其他'
  );

alter table products
  alter column category set default '其他';

alter table products
  drop constraint if exists products_standard_category_check;

alter table products
  add constraint products_standard_category_check
  check (
    category in (
      '监控',
      '门锁',
      '传感器',
      '窗帘',
      '开关',
      '插座',
      '暖通控制',
      '网关中控',
      '全屋wifi',
      '智能灯具',
      '普通灯具',
      '其他'
    )
  );
