-- 规整产品平台/品牌枚举
-- 平台白名单：米家, 绿米, 华为, Apple Home, Google Home, knx, tuya, 其他
-- 品牌白名单：领普/Linptech, 平头熊/PTX, 易来/yeelight, 鹿客, 中弘, Aqara, 小米/xiaomi, 锐捷/Ruijie, 金闪, 其他

DO $$
BEGIN
  -- 平台对齐
  UPDATE products SET
    platform = CASE
      WHEN platform = '米家' THEN '米家'
      WHEN platform = 'Aqara / Apple Home' THEN 'Apple Home'
      WHEN platform = '华为全屋智能' THEN '华为'
      WHEN platform = 'Tuya' THEN 'tuya'
      WHEN platform = 'KNX' THEN 'knx'
      ELSE '其他'
    END
  WHERE deleted_at IS NULL;

  -- 品牌对齐
  UPDATE products SET
    brand = CASE
      WHEN brand IN ('易来', 'Yeelight') THEN '易来/yeelight'
      WHEN brand IN ('锐捷', 'Ruijie') THEN '锐捷/Ruijie'
      WHEN brand IN ('领普', '领普/Linptech') THEN '领普/Linptech'
      WHEN brand = '小米' THEN '小米/xiaomi'
      WHEN brand = '平头熊' THEN '平头熊/PTX'
      WHEN brand IN ('Aqara', '鹿客', '中弘') THEN brand
      WHEN brand = '今闪' THEN '金闪'
      ELSE '其他'
    END
  WHERE deleted_at IS NULL;

  -- 平台 CHECK 约束（NOT VALID：只校验未来写入，不回扫存量软删除行）
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_platform_whitelist_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_platform_whitelist_check
      CHECK (platform ISNULL OR platform IN (
        '米家', '绿米', '华为', 'Apple Home', 'Google Home', 'knx', 'tuya', '其他'
      )) NOT VALID;
  END IF;

  -- 品牌 CHECK 约束
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_whitelist_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_brand_whitelist_check
      CHECK (brand ISNULL OR brand IN (
        '领普/Linptech', '平头熊/PTX', '易来/yeelight', '鹿客', '中弘',
        'Aqara', '小米/xiaomi', '锐捷/Ruijie', '金闪', '其他'
      )) NOT VALID;
  END IF;
END $$;