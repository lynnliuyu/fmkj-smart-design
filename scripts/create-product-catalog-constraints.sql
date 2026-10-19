-- Add schema rules without guessing or rewriting catalog values.
-- Brands are extensible (for example SUMI) and validated by product administration.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_whitelist_check;
ALTER TABLE products ALTER COLUMN category SET DEFAULT '其他';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_standard_category_check' AND conrelid = 'products'::regclass) THEN
    ALTER TABLE products ADD CONSTRAINT products_standard_category_check CHECK (
      category IN ('监控', '门锁', '传感器', '窗帘', '开关', '插座', '暖通控制', '网关中控', '全屋wifi', '智能灯具', '普通灯具', '其他')
    ) NOT VALID;
  END IF;
END $$;
