#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

command -v node >/dev/null 2>&1 || { echo "需要安装 Node.js 22 或更新版本。" >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("需要 Node.js 22 或更新版本。"); process.exit(1); }'
command -v pnpm >/dev/null 2>&1 || { echo "需要安装 pnpm 12。" >&2; exit 1; }
pnpm_version="$(pnpm --version)"
if [[ "$pnpm_version" != 12.* ]]; then
  echo "需要 pnpm 12，当前版本为 ${pnpm_version}。" >&2
  exit 1
fi

echo "安装锁文件中的依赖……"
pnpm install --frozen-lockfile

node --input-type=module <<'NODE'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env.local')) {
  console.log('保留已有 .env.local，未修改其中任何值。');
} else {
  const template = readFileSync('.env.local.example', 'utf8');
  if (!/^AUTH_SECRET=$/m.test(template)) throw new Error('环境模板缺少空 AUTH_SECRET，停止生成。');
  const content = template.replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${randomBytes(32).toString('base64')}`);
  writeFileSync('.env.local', content, { flag: 'wx', mode: 0o600 });
  console.log('已创建 .env.local 并写入随机 AUTH_SECRET（不显示密钥）。');
}
NODE

cat <<'NEXT'
环境准备完成；尚未启动服务或修改数据库。
后续步骤：
  1. 检查 .env.local；默认连接仅适用于本机一次性 Docker 开发库。
  2. pnpm run db:up                 # 现有 PostgreSQL 可跳过
     docker compose -f docker-compose.db.yml ps   # 等待数据库健康
  3. pnpm run db:migrate
  4. 在 .env.local 设置 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD。
     pnpm run db:seed-admin         # 会创建或更新管理员；之后移除引导密码
  5. pnpm run dev                  # 打开 http://localhost:3000
完整配置与生产模式见 README.md 和 docs/environment.md。
NEXT
