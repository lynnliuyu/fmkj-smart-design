-- 平台角色表 + users.role_id
--
-- 历史背景：`app/api/auth/register/route.ts`、`app/api/auth/login/route.ts`、
-- `lib/account-team-service.ts` 都会读 `roles` 表并写 `users.role_id`，
-- 但早期迁移链没有创建它们（原来 Neon 库里是手工建的），
-- 导致在全新数据库上注册/验证码登录会直接报错。
-- 本迁移把这两个对象纳入正式迁移链，并补齐默认角色种子。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- roles：平台内置角色字典
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- users.role_id 外键
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_id_fkey
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_key ON roles (key) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 默认角色种子
-- 固定 UUID，与登录/注册路由中的兜底常量保持一致：
--   member = 10000000-0000-0000-0000-000000000021
-- ---------------------------------------------------------------------------
INSERT INTO roles (id, key, name, description)
VALUES
  ('10000000-0000-0000-0000-000000000021', 'member', '成员', '平台默认成员角色'),
  ('10000000-0000-0000-0000-000000000022', 'sales', '销售', '销售岗位角色'),
  ('10000000-0000-0000-0000-000000000023', 'owner', '负责人', '项目负责人角色')
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 回填存量用户的 role_id
-- ---------------------------------------------------------------------------
UPDATE users
SET role_id = '10000000-0000-0000-0000-000000000021'
WHERE role_id IS NULL
  AND deleted_at IS NULL;
