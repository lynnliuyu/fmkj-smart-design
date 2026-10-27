-- 登录失败记录：给「同一个账号 / 同一个来源短时间内反复试密码」上一个次数闸门。
--
-- 只记失败（成功即删），所以正常使用不会累积；一天前的记录会被机会式清理。
-- 不存密码、不存 token，只有限流用的键与时间。
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_key_time_idx
  ON login_attempts (key, occurred_at DESC);
