import { getPool } from "./server-db"

/**
 * 登录与验证码的频率限制。
 *
 * 原来这两条路没有任何次数限制：密码可以无限次试，验证码可以无限次发
 * （接了真实短信/邮件后就是直接烧钱）。这里按「账号」和「来源」两个维度限制：
 *
 * - 账号维度：同一个邮箱/手机号 15 分钟内最多失败 8 次。
 * - 来源维度：同一个 IP 15 分钟内最多失败 40 次（只在能拿到真实来源时启用——
 *   自部署设备常常没有反向代理，拿不到来源就不做全局封禁，免得一个人把全公司锁在门外）。
 * - 发验证码：同一个目标 1 小时最多 5 条，直接数 verification_codes 里已有记录，不另建表。
 * - 登录成功即清零，正常的用户不会因为前几天输错过就受影响。
 */

export const LOGIN_TARGET_LIMIT = { limit: 8, windowSeconds: 900 }
export const LOGIN_CLIENT_LIMIT = { limit: 40, windowSeconds: 900 }
export const SEND_CODE_LIMIT = { limit: 5, windowSeconds: 3600 }

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }

export type LoginGuardDependencies = { db?: Queryable }

export type RateLimitStatus = {
  allowed: boolean
  retryAfterSeconds: number
  used: number
}

function db(dependencies: LoginGuardDependencies): Queryable {
  return dependencies.db ?? (getPool() as unknown as Queryable)
}

export function normalizeLoginTarget(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

/** 从请求头取来源；拿不到就返回空串，调用方据此跳过来源维度的限制。 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded
  return headers.get("x-real-ip")?.trim() ?? ""
}

function retryAfter(seconds: number): number {
  return Math.max(1, Math.ceil(seconds))
}

/** 数一数窗口内这个键失败了几次，超了就不允许。 */
async function countWithin(key: string, limit: number, windowSeconds: number, dependencies: LoginGuardDependencies): Promise<RateLimitStatus> {
  const result = await db(dependencies).query(
    `select count(*)::int as count,
            coalesce(extract(epoch from (now() - min(occurred_at))), 0)::int as oldest_age
     from login_attempts
     where key = $1 and occurred_at > now() - make_interval(secs => $2)`,
    [key, windowSeconds],
  )
  const used = Number(result.rows[0]?.count ?? 0)
  const oldestAge = Number(result.rows[0]?.oldest_age ?? 0)
  return {
    allowed: used < limit,
    retryAfterSeconds: used < limit ? 0 : retryAfter(windowSeconds - oldestAge),
    used,
  }
}

async function record(key: string, dependencies: LoginGuardDependencies): Promise<void> {
  await db(dependencies).query("insert into login_attempts (key) values ($1)", [key])
}

/**
 * 登录前的检查。账号维度是硬门禁；来源维度只在识别得出来源时生效。
 */
export async function checkLoginAllowed(
  target: string,
  client: string,
  dependencies: LoginGuardDependencies = {},
): Promise<RateLimitStatus> {
  const normalized = normalizeLoginTarget(target)
  const byTarget = await countWithin(`target:${normalized}`, LOGIN_TARGET_LIMIT.limit, LOGIN_TARGET_LIMIT.windowSeconds, dependencies)
  if (!byTarget.allowed) return byTarget
  if (!client) return byTarget
  const byClient = await countWithin(`client:${client}`, LOGIN_CLIENT_LIMIT.limit, LOGIN_CLIENT_LIMIT.windowSeconds, dependencies)
  return byClient.allowed ? byTarget : byClient
}

/** 记一次失败。成功时不记，避免正常用户把自己顶到上限。 */
export async function recordLoginFailure(target: string, client: string, dependencies: LoginGuardDependencies = {}): Promise<void> {
  await record(`target:${normalizeLoginTarget(target)}`, dependencies)
  if (client) await record(`client:${client}`, dependencies)
}

/** 登录成功后清零，本账号的历史失败不再累计。 */
export async function clearLoginFailures(target: string, client: string, dependencies: LoginGuardDependencies = {}): Promise<void> {
  const keys = [`target:${normalizeLoginTarget(target)}`]
  if (client) keys.push(`client:${client}`)
  await db(dependencies).query("delete from login_attempts where key = any($1)", [keys])
}

/**
 * 发验证码前的检查：直接数已经发出去的验证码，不另建表。
 * 顺带把过期很久的记录清掉，这张表本来就是按目标+时间查的。
 */
export async function checkSendCodeAllowed(target: string, dependencies: LoginGuardDependencies = {}): Promise<RateLimitStatus> {
  const normalized = normalizeLoginTarget(target)
  const result = await db(dependencies).query(
    `select count(*)::int as count,
            coalesce(extract(epoch from (now() - min(created_at))), 0)::int as oldest_age
     from verification_codes
     where lower(target) = $1 and created_at > now() - make_interval(secs => $2)`,
    [normalized, SEND_CODE_LIMIT.windowSeconds],
  )
  const used = Number(result.rows[0]?.count ?? 0)
  const oldestAge = Number(result.rows[0]?.oldest_age ?? 0)
  return {
    allowed: used < SEND_CODE_LIMIT.limit,
    retryAfterSeconds: used < SEND_CODE_LIMIT.limit ? 0 : retryAfter(SEND_CODE_LIMIT.windowSeconds - oldestAge),
    used,
  }
}

/** 顺手清理：一天前的登录失败记录留着没有用。 */
export async function pruneLoginAttempts(dependencies: LoginGuardDependencies = {}): Promise<void> {
  await db(dependencies).query("delete from login_attempts where occurred_at < now() - interval '1 day'")
}
