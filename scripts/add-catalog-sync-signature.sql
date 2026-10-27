-- 同步批次补记「这份资料有没有验签」。
--
-- 先建的 catalog_sync_runs 只记了版本与计数；引入 Ed25519 验证后，
-- 管理员需要能一眼看出「上次同步的资料是签过名的，还是无签名的」。
ALTER TABLE catalog_sync_runs
  ADD COLUMN IF NOT EXISTS signature TEXT NOT NULL DEFAULT '';
