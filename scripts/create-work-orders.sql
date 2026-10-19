-- 工单与标准计价系统
-- Run via: pnpm db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_type') THEN
    CREATE TYPE work_order_type AS ENUM ('measure', 'install', 'commission', 'after_sale');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_status') THEN
    CREATE TYPE work_order_status AS ENUM ('draft', 'scheduled', 'in_progress', 'done', 'canceled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_priority') THEN
    CREATE TYPE work_order_priority AS ENUM ('low', 'normal', 'high');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_pricing_mode') THEN
    CREATE TYPE work_pricing_mode AS ENUM ('fixed', 'per_unit', 'per_product');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_org_pricing_kind') THEN
    CREATE TYPE work_org_pricing_kind AS ENUM ('override', 'custom');
  END IF;
END $$;

-- 平台标准工作条目库
CREATE TABLE IF NOT EXISTS work_pricing_catalog (
  id uuid primary key default gen_random_uuid(),
  work_type work_order_type not null,
  code text not null unique,
  name text not null,
  description text,
  pricing_mode work_pricing_mode not null,
  default_unit_price_cents integer not null default 0,
  unit_name text not null default '次',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 公司级定价：覆盖标准条目 + 公司自定义条目
CREATE TABLE IF NOT EXISTS work_org_pricing (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  kind work_org_pricing_kind not null,
  catalog_code text,
  work_type work_order_type not null,
  name text not null,
  description text,
  pricing_mode work_pricing_mode not null,
  unit_price_cents integer not null default 0,
  unit_name text not null default '次',
  sort_override integer,
  is_hidden boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_org_pricing_override_unique unique (organization_id, catalog_code)
);

CREATE INDEX IF NOT EXISTS work_org_pricing_org_idx ON work_org_pricing (organization_id, work_type);

-- 主工单表
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  work_types work_order_type[] not null default '{}',
  status work_order_status not null default 'draft',
  priority work_order_priority not null default 'normal',
  assignee_id uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  completion_content text,
  completion_note text,
  final_fee_cents integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS work_orders_project_idx ON work_orders (project_id, created_at desc) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_assignee_idx ON work_orders (assignee_id) WHERE assignee_id IS NOT NULL AND deleted_at IS NULL;

-- 工单携带的报价产品快照
CREATE TABLE IF NOT EXISTS work_order_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  product_id uuid,
  quote_item_id uuid,
  name text not null,
  spec text,
  unit text not null default '个',
  quantity numeric(12, 2) not null default 1,
  actual_quantity numeric(12, 2),
  room text,
  unit_price_cents integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS work_order_items_order_idx ON work_order_items (work_order_id, sort_order);

-- 完成工单时的计价明细行（标准条目展开 + 公司自定义 + 临时行）
CREATE TABLE IF NOT EXISTS work_order_work_lines (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  catalog_code text,
  work_type work_order_type not null,
  name text not null,
  description text,
  pricing_mode work_pricing_mode not null,
  quantity numeric(12, 2) not null default 0,
  unit_name text not null default '次',
  unit_price_cents integer not null default 0,
  line_total_cents integer not null default 0,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS work_order_work_lines_order_idx ON work_order_work_lines (work_order_id, sort_order);

-- 工单照片关联（复用 project_site_photos）
CREATE TABLE IF NOT EXISTS work_order_photos (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  photo_id uuid not null references project_site_photos(id) on delete cascade,
  primary key (work_order_id, photo_id),
  created_at timestamptz not null default now()
);

-- 平台标准工作条目库种子
DO $$
DECLARE
  catalog_seed work_pricing_catalog;
BEGIN
  INSERT INTO work_pricing_catalog (work_type, code, name, description, pricing_mode, default_unit_price_cents, unit_name, sort_order)
  VALUES
    ('measure', 'measure.measure_basic', '现场测量', '入户测量基础工作，含到场、量尺、与业主沟通', 'fixed', 8000, '次', 10),
    ('measure', 'measure.recheck_points', '点位复核', '对原设计点位现场复核', 'per_unit', 4000, '点位', 20),
    ('measure', 'measure.archive_photos', '拍照存档', '按规范拍摄现场实拍', 'fixed', 2000, '次', 30),
    ('measure', 'measure.report', '出具复核单', '回公司出具复核单并交底', 'fixed', 5000, '次', 40),
    ('install', 'install.main', '主设备安装', '按携带产品逐件安装主设备', 'per_product', 6000, '件', 10),
    ('install', 'install.aux', '辅材敷设', '管线槽等辅材敷设', 'per_unit', 3000, '点位', 20),
    ('install', 'install.network', '联网调试', '单机通电与联网', 'per_product', 4000, '件', 30),
    ('install', 'install.clean', '现场清理', '完工后清理现场', 'fixed', 2000, '次', 40),
    ('commission', 'commission.integrate', '系统联调', '全屋系统联调与场景验证', 'per_unit', 5000, '场景', 10),
    ('commission', 'commission.config', '参数配置', '调参、面板配置、固件升级', 'per_unit', 3000, '项', 20),
    ('commission', 'commission.demo', '走查演示', '陪客户走查并演示功能', 'fixed', 5000, '次', 30),
    ('after_sale', 'after_sale.diagnose', '故障排查', '到场排查故障', 'per_unit', 8000, '次', 10),
    ('after_sale', 'after_sale.replace', '备件更换', '更换备件', 'per_product', 5000, '件', 20),
    ('after_sale', 'after_sale.visit', '回访记录', '上门回访并整理记录', 'fixed', 2000, '次', 30)
  ON CONFLICT (code) DO NOTHING;
END $$;