-- 已有安装永久关闭匿名初始化；管理员停用、降级或删除不代表设备恢复出厂。
-- 与首次设置使用同一把事务锁，避免升级时与首次创建交错。
SELECT pg_advisory_xact_lock(hashtext('fmkj-first-run-setup'));

INSERT INTO platform_settings (key, value)
SELECT 'INTERNAL_FIRST_RUN_INITIALIZED', now()::text
WHERE EXISTS (SELECT 1 FROM users)
   OR EXISTS (SELECT 1 FROM projects)
   OR EXISTS (SELECT 1 FROM quotes)
   OR EXISTS (SELECT 1 FROM activity_logs)
ON CONFLICT (key) DO NOTHING;
