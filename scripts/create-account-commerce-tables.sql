-- Account commerce migration for fmkj_v3
-- Run via: pnpm db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE account_type AS ENUM (
      'SUPER_ADMIN',
      'ENTERPRISE_OWNER',
      'ENTERPRISE_MEMBER',
      'PERSONAL_PRO',
      'PERSONAL_FREE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_profile_status') THEN
    CREATE TYPE account_profile_status AS ENUM ('active', 'disabled', 'deleted');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_subject_type') THEN
    CREATE TYPE subscription_subject_type AS ENUM ('user', 'organization');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_cycle') THEN
    CREATE TYPE billing_cycle AS ENUM ('free', 'monthly', 'yearly', 'custom');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM (
      'free',
      'active',
      'grace_period',
      'past_due',
      'expired',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_status') THEN
    CREATE TYPE organization_status AS ENUM ('active', 'disabled', 'expired', 'deleted');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('invited', 'active', 'disabled', 'removed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'canceled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_type account_type NOT NULL DEFAULT 'PERSONAL_FREE',
  account_status account_profile_status NOT NULL DEFAULT 'active',
  organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  billing_cycle billing_cycle NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type subscription_subject_type NOT NULL,
  subject_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES plans(id),
  status subscription_status NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type subscription_subject_type NOT NULL,
  subject_id UUID NOT NULL,
  plan_id UUID REFERENCES plans(id),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status order_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_by_user_id UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by_user_id UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  status organization_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_role_permissions (
  role_id UUID NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES organization_roles(id),
  member_status member_status NOT NULL DEFAULT 'invited',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_type TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS owner_id UUID,
  ADD COLUMN IF NOT EXISTS transferred_from_user_id UUID;

UPDATE projects
SET owner_type = COALESCE(owner_type, 'user'),
    owner_id = COALESCE(owner_id, created_by)
WHERE owner_id IS NULL OR owner_type IS NULL;

ALTER TABLE projects
  ALTER COLUMN owner_type SET NOT NULL;

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'edit',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_active_subject_idx
  ON subscriptions (subject_type, subject_id)
  WHERE status IN ('free', 'active', 'grace_period', 'past_due');

CREATE INDEX IF NOT EXISTS account_profiles_type_idx
  ON account_profiles (account_type, account_status);

CREATE INDEX IF NOT EXISTS plans_sort_idx
  ON plans (sort_order, plan_code);

CREATE INDEX IF NOT EXISTS orders_recent_idx
  ON orders (created_at DESC, status);

CREATE INDEX IF NOT EXISTS orders_subject_idx
  ON orders (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS feature_flags_updated_idx
  ON feature_flags (updated_at DESC);

CREATE INDEX IF NOT EXISTS platform_settings_updated_idx
  ON platform_settings (updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_active_owner_idx
  ON organizations (owner_user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS organization_roles_system_code_idx
  ON organization_roles (code)
  WHERE is_system = true;

CREATE UNIQUE INDEX IF NOT EXISTS organization_members_user_idx
  ON organization_members (organization_id, user_id);

CREATE INDEX IF NOT EXISTS organization_members_status_idx
  ON organization_members (organization_id, member_status);

CREATE INDEX IF NOT EXISTS projects_owner_idx
  ON projects (owner_type, owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_transferred_from_user_idx
  ON projects (transferred_from_user_id)
  WHERE transferred_from_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_idx
  ON project_members (project_id, user_id);

INSERT INTO plans (plan_code, name, billing_cycle, price_cents, currency, limits, sort_order)
VALUES
  (
    'FREE',
    '个人免费版',
    'free',
    0,
    'CNY',
    '{"maxProjects":1,"maxMembers":0,"canUsePointMap":false,"canCreateTeam":false,"canCreateSubAccounts":false,"canUseAdvancedExport":false,"storageLimitMb":200,"supportLevel":"standard"}'::jsonb,
    10
  ),
  (
    'PERSONAL_PRO_MONTHLY',
    '个人升级版（月付）',
    'monthly',
    3900,
    'CNY',
    '{"maxProjects":null,"maxMembers":0,"canUsePointMap":true,"canCreateTeam":false,"canCreateSubAccounts":false,"canUseAdvancedExport":true,"storageLimitMb":2048,"supportLevel":"priority"}'::jsonb,
    20
  ),
  (
    'PERSONAL_PRO_YEARLY',
    '个人升级版（年付）',
    'yearly',
    39900,
    'CNY',
    '{"maxProjects":null,"maxMembers":0,"canUsePointMap":true,"canCreateTeam":false,"canCreateSubAccounts":false,"canUseAdvancedExport":true,"storageLimitMb":2048,"supportLevel":"priority"}'::jsonb,
    30
  ),
  (
    'ENTERPRISE_MONTHLY',
    '企业版（月付）',
    'monthly',
    19900,
    'CNY',
    '{"maxProjects":null,"maxMembers":20,"canUsePointMap":true,"canCreateTeam":true,"canCreateSubAccounts":true,"canUseAdvancedExport":true,"storageLimitMb":10240,"supportLevel":"enterprise"}'::jsonb,
    40
  ),
  (
    'ENTERPRISE_YEARLY',
    '企业版（年付）',
    'yearly',
    199900,
    'CNY',
    '{"maxProjects":null,"maxMembers":20,"canUsePointMap":true,"canCreateTeam":true,"canCreateSubAccounts":true,"canUseAdvancedExport":true,"storageLimitMb":10240,"supportLevel":"enterprise"}'::jsonb,
    50
  ),
  (
    'ENTERPRISE_CUSTOM',
    '企业定制版',
    'custom',
    0,
    'CNY',
    '{"maxProjects":null,"maxMembers":null,"canUsePointMap":true,"canCreateTeam":true,"canCreateSubAccounts":true,"canUseAdvancedExport":true,"storageLimitMb":null,"supportLevel":"dedicated"}'::jsonb,
    60
  )
ON CONFLICT (plan_code) DO UPDATE
SET
  name = EXCLUDED.name,
  billing_cycle = EXCLUDED.billing_cycle,
  currency = EXCLUDED.currency,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO account_profiles (user_id, account_type, account_status)
SELECT
  u.id,
  CASE
    WHEN lower(coalesce(u.role, 'member')) = 'admin' THEN 'SUPER_ADMIN'::account_type
    WHEN lower(coalesce(u.role, 'member')) = 'manager' THEN 'PERSONAL_PRO'::account_type
    ELSE 'PERSONAL_FREE'::account_type
  END,
  CASE
    WHEN u.status::text = 'active' THEN 'active'::account_profile_status
    ELSE 'disabled'::account_profile_status
  END
FROM users u
ON CONFLICT (user_id) DO NOTHING;
