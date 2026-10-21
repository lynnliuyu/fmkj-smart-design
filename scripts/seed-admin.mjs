// Seed a super admin user into the database.
// Usage: pnpm db:seed-admin
// Custom credentials:
//   node scripts/seed-admin.mjs --email=you@example.com --password=YourPassword --name=Admin
// Or via environment variables:
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=YourPassword pnpm db:seed-admin

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs"
import { Pool } from "pg"

loadLocalEnv();

const DEFAULT_EMAIL = "admin@fmkj.com"
const DEFAULT_NAME = "超级管理员"

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.split("=")
  acc[key.replace(/^--/, "")] = val
  return acc
}, {})

const email = args.email || process.env.SEED_ADMIN_EMAIL || DEFAULT_EMAIL
const password = args.password || process.env.SEED_ADMIN_PASSWORD
const name = args.name || DEFAULT_NAME

async function seed() {
  console.log("\nSeeding super admin...")
  console.log(`Email: ${email}`)
  console.log(`Name: ${name}`)

  if (!password) {
    console.error(
      "\nPassword is required. Provide it via --password=YourPassword or SEED_ADMIN_PASSWORD env var."
    )
    console.error("Do NOT hardcode passwords in the script.")
    process.exit(1)
  }

  if (!process.env.DATABASE_URL) {
    console.error("\nDATABASE_URL environment variable is not set.")
    console.error("Set it in .env.local or export it before running this script.")
    process.exit(1)
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  })

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      `
      insert into users (email, password_hash, name, role, status)
      values ($1, $2, $3, 'admin', 'active')
      on conflict (email) do update set
        password_hash = excluded.password_hash,
        role = excluded.role,
        name = excluded.name,
        status = excluded.status,
        updated_at = now()
      returning id::text, email, phone, name, role, status
      `,
      [email, passwordHash, name]
    )

    const user = result.rows[0]

    // 账号档案缺失会让权限服务把该账号判定为 ACCOUNT_DISABLED，这里补齐。
    await pool.query(
      `
      insert into account_profiles (user_id, account_type, account_status)
      values ($1::uuid, 'SUPER_ADMIN', 'active')
      on conflict (user_id) do update
      set account_type = excluded.account_type,
          account_status = excluded.account_status,
          updated_at = now()
      `,
      [user.id]
    )

    // SUPER_ADMIN 不依赖套餐，但后台账号列表会展示套餐列，给一条企业定制版订阅。
    await pool.query(
      `
      update subscriptions
      set status = 'canceled', canceled_at = coalesce(canceled_at, now()), updated_at = now()
      where subject_type = 'user' and subject_id = $1::uuid
        and status in ('free', 'active', 'grace_period', 'past_due')
      `,
      [user.id]
    )
    await pool.query(
      `
      insert into subscriptions (subject_type, subject_id, plan_id, status, starts_at)
      select 'user', $1::uuid, id, 'active', now()
      from plans
      where plan_code = 'ENTERPRISE_CUSTOM' and is_active = true
      on conflict do nothing
      `,
      [user.id]
    )

    console.log("\nSuper admin created or updated.")
    console.log(`ID: ${user.id}`)
    console.log(`Email: ${user.email}`)
    console.log(`Name: ${user.name}`)
    console.log(`Role: ${user.role}`)
    console.log("Account type: SUPER_ADMIN")
    console.log("\nLogin URL: /login")
    console.log("Password is set from your input — change it after first login.")
  } catch (error) {
    console.error(
      "\nFailed to seed admin:",
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  } finally {
    await pool.end()
  }
}

await seed()

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
