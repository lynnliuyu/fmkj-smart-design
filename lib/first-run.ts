import bcrypt from "bcryptjs"

import { getPool } from "./server-db"

/**
 * 首次初始化：设备出厂时数据库是空的，没有管理员就没人能登录。
 * 按用户 2026-10-22 的决定，**不代客户设密码**——客户第一次打开页面时自己填。
 *
 * 初始化完成后保存永久标记，不因管理员停用、降级或删除而重新开放。
 * 创建时先取事务级锁，再检查状态、创建账号并写标记；并发提交只允许一个成功。
 */

export type FirstRunState = {
  databaseReady: boolean
  needsSetup: boolean
}

/** 内部设置，不出现在管理员可编辑的品牌/环境设置列表里。 */
export const FIRST_RUN_INITIALIZED_KEY = "INTERNAL_FIRST_RUN_INITIALIZED"

// 兼容升级前尚无标记的安装：已有账号或客户业务资料就不能匿名接管。
// 不按账号角色或启用状态判断；账号恢复必须走经过授权的本机管理步骤。
const INITIALIZATION_STATE_SQL = `select (
  exists (select 1 from platform_settings where key = $1)
  or exists (select 1 from users)
  or exists (select 1 from projects)
  or exists (select 1 from quotes)
  or exists (select 1 from activity_logs)
) as initialized`

export class FirstRunError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
    this.name = "FirstRunError"
  }
}

/**
 * 数据库还没起来时返回 `databaseReady:false`，而不是「需要初始化」——
 * 否则数据库一抖动，页面就会把已经装好的设备当成新机器，让人再建一遍管理员。
 */
export async function getFirstRunState(): Promise<FirstRunState> {
  try {
    const result = await getPool().query<{ initialized: boolean }>(INITIALIZATION_STATE_SQL, [FIRST_RUN_INITIALIZED_KEY])
    return { databaseReady: true, needsSetup: result.rows[0]?.initialized === false }
  } catch {
    return { databaseReady: false, needsSetup: false }
  }
}

export type FirstAdminInput = {
  email: string
  name: string
  password: string
}

/** 返回给页面看的错误说明；没问题返回 null。 */
export function validateFirstAdmin(input: Partial<FirstAdminInput>): string | null {
  const name = String(input.name ?? "").trim()
  const email = String(input.email ?? "").trim()
  const password = String(input.password ?? "")
  if (!name) return "请填写你的名字"
  if (name.length > 60) return "名字太长了"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请填写有效的邮箱地址"
  if (email.length > 160) return "邮箱地址太长了"
  if (password.length < 8) return "密码至少 8 位"
  if (password.length > 200) return "密码太长了"
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码里要有字母和数字"
  return null
}

export async function createFirstAdmin(input: FirstAdminInput): Promise<{ email: string; name: string; userId: string }> {
  const invalid = validateFirstAdmin(input)
  if (invalid) throw new FirstRunError("INVALID_INPUT", invalid)

  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  const passwordHash = await bcrypt.hash(input.password, 10)
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query("begin")
    await client.query("select pg_advisory_xact_lock(hashtext('fmkj-first-run-setup'))")
    const state = await client.query<{ initialized: boolean }>(INITIALIZATION_STATE_SQL, [FIRST_RUN_INITIALIZED_KEY])
    if (state.rows[0]?.initialized !== false) {
      throw new FirstRunError("ALREADY_INITIALIZED", "这台设备已经初始化过了，请直接用管理员账号登录。", 409)
    }

    const userId = (await client.query<{ id: string }>(
      `insert into users (email, password_hash, name, role, status)
       values ($1, $2, $3, 'admin', 'active')
       returning id::text`,
      [email, passwordHash, name],
    )).rows[0]?.id
    if (!userId) throw new FirstRunError("SETUP_FAILED", "管理员账号未能创建，请稍后重试。", 500)

    // 账号档案缺失会被权限服务判定为停用，必须补齐（与 scripts/seed-admin.mjs 一致）。
    await client.query(
      `insert into account_profiles (user_id, account_type, account_status)
       values ($1::uuid, 'SUPER_ADMIN', 'active')
       on conflict (user_id) do update
         set account_type = excluded.account_type, account_status = excluded.account_status, updated_at = now()`,
      [userId],
    )
    // 后台账号列表会展示套餐列，给一条企业定制版订阅。
    await client.query(
      `update subscriptions set status = 'canceled', canceled_at = coalesce(canceled_at, now()), updated_at = now()
        where subject_type = 'user' and subject_id = $1::uuid and status in ('free', 'active', 'grace_period', 'past_due')`,
      [userId],
    )
    await client.query(
      `insert into subscriptions (subject_type, subject_id, plan_id, status, starts_at)
       select 'user', $1::uuid, id, 'active', now() from plans
        where plan_code = 'ENTERPRISE_CUSTOM' and is_active = true
       on conflict do nothing`,
      [userId],
    )
    await client.query(
      `insert into platform_settings (key, value, updated_by_user_id)
       values ($1, now()::text, $2::uuid)
       on conflict (key) do nothing`,
      [FIRST_RUN_INITIALIZED_KEY, userId],
    )

    await client.query("commit")
    return { email, name, userId }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
