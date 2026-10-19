// 本地数据库连通性与写读冒烟测试。
// 验证 pg 直连、登录链路依赖的表、以及一次真实写入。
// 运行：node scripts/db-smoke-test.mjs

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

loadLocalEnv();

const checks = [];

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法执行冒烟测试。");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

try {
  const version = await pool.query("select version() as version");
  record("连接数据库", true, version.rows[0].version.split(" ").slice(0, 2).join(" "));

  // 登录/注册链路依赖的表
  for (const table of ["users", "roles", "account_profiles", "plans", "verification_codes"]) {
    const result = await pool.query("select to_regclass($1) as t", [`public.${table}`]);
    record(`表 ${table}`, Boolean(result.rows[0].t), result.rows[0].t ? "" : "缺失");
  }

  // 权限链路依赖的枚举
  for (const type of ["account_type", "member_status", "subscription_status", "order_status"]) {
    const result = await pool.query("select 1 from pg_type where typname = $1", [type]);
    record(`枚举 ${type}`, result.rowCount > 0, result.rowCount > 0 ? "" : "缺失");
  }

  // 套餐种子
  const plans = await pool.query("select count(*)::int as count from plans where is_active = true");
  record("套餐种子", plans.rows[0].count > 0, `${plans.rows[0].count} 个`);

  // 默认角色种子
  const roles = await pool.query("select count(*)::int as count from roles where deleted_at is null");
  record("平台角色种子", roles.rows[0].count > 0, `${roles.rows[0].count} 个`);

  // 真实写入 + 读回 + 回滚
  const client = await pool.connect();
  try {
    await client.query("begin");
    const code = `SMOKE-${Date.now()}`;
    await client.query(
      `insert into project_communities (name, city) values ($1, $2)`,
      [code, "冒烟测试"]
    );
    const readBack = await client.query(
      "select city from project_communities where name = $1",
      [code]
    );
    record(
      "写入并读回",
      readBack.rows[0]?.city === "冒烟测试",
      readBack.rows[0] ? "" : "读回失败"
    );
    await client.query("rollback");
    const afterRollback = await client.query(
      "select count(*)::int as count from project_communities where name = $1",
      [code]
    );
    record("回滚生效", afterRollback.rows[0].count === 0);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
} catch (error) {
  record("执行", false, error instanceof Error ? error.message : String(error));
} finally {
  await pool.end();
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const check of checks) {
  const label = check.ok ? "PASS" : "FAIL";
  const detail = check.detail ? `  ${check.detail}` : "";
  console.log(`${label.padEnd(4)} ${check.name.padEnd(width)}${detail}`);
}

const failed = checks.filter((c) => !c.ok);
console.log("");
console.log(`冒烟测试：${failed.length} 项失败，${checks.length} 项总计。`);
process.exitCode = failed.length > 0 ? 1 : 0;

function loadLocalEnv() {
  const envPath = resolve(".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
