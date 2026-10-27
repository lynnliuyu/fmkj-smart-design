-- 官方产品资料同步的运行记录（同步批次）。
--
-- 记录每次同步用的资料版本、结果和失败原因，给管理员页面看，也给「上次同步到哪一版」留个凭据。
-- 不在这里存凭据、地址或任何客户业务数据。
CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  actor_user_id UUID REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS catalog_sync_runs_started_idx
  ON catalog_sync_runs (started_at DESC);
