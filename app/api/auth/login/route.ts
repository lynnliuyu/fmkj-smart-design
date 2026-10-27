import bcrypt from "bcryptjs"
import { NextRequest, NextResponse } from "next/server"

import { signSessionToken, setSessionCookie, type AuthUser } from "@/lib/auth"
import { checkLoginAllowed, clearLoginFailures, clientAddress, pruneLoginAttempts, recordLoginFailure } from "@/lib/login-guard"
import { getPool, hasDatabaseUrl } from "@/lib/server-db"
import { verifyCode } from "@/lib/verification"

type DbUser = {
  id: string
  email: string | null
  phone: string | null
  password_hash: string | null
  name: string
  role: string
  status: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const mode = String(body.mode ?? "")

    const client = clientAddress(request.headers)
    // 顺手清掉一天前的失败记录：这张表只用来限制短时间内的反复尝试。
    void pruneLoginAttempts().catch(() => {})

    if (mode === "password") {
      return loginWithPassword(body.email, body.password, client)
    }

    if (mode === "code") {
      return loginWithCode(body.target, body.code, client)
    }

    return NextResponse.json({ error: "无效的登录方式" }, { status: 400 })
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        route: "/api/auth/login",
        message: error instanceof Error ? error.message : "LOGIN_FAILED",
        name: error instanceof Error ? error.name : "UnknownError",
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3) : undefined,
      })
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 500 }
    )
  }
}

async function loginWithPassword(
  email: string,
  password: string,
  client: string
): Promise<NextResponse> {
  const normalizedEmail = String(email ?? "").trim().toLowerCase()

  if (!normalizedEmail || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 })
  }

  const throttled = await tooManyAttempts(normalizedEmail, client)
  if (throttled) return throttled

  if (isLocalAuthFallbackEnabled()) {
    return issueLocalSession(normalizedEmail)
  }

  const result = await getPool().query<DbUser>(
    `
    select
      id::text,
      email,
      phone,
      password_hash,
      name,
      coalesce(role, 'member') as role,
      status::text as status
    from users
    where lower(email) = $1
      and status::text = 'active'
      and deleted_at is null
    limit 1
    `,
    [normalizedEmail]
  )

  const user = result.rows[0]
  if (!user) {
    await recordLoginFailure(normalizedEmail, client)
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 })
  }

  if (!user.password_hash) {
    return NextResponse.json(
      { error: "该账号未设置密码，请使用验证码登录" },
      { status: 400 }
    )
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    await recordLoginFailure(normalizedEmail, client)
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 })
  }

  await clearLoginFailures(normalizedEmail, client)
  return issueSession(user)
}

async function loginWithCode(
  target: string,
  code: string,
  client: string
): Promise<NextResponse> {
  const trimmedTarget = String(target ?? "").trim()

  if (!trimmedTarget || !code) {
    return NextResponse.json({ error: "请输入邮箱/手机号和验证码" }, { status: 400 })
  }

  const throttled = await tooManyAttempts(trimmedTarget, client)
  if (throttled) return throttled

  if (isLocalAuthFallbackEnabled()) {
    return issueLocalSession(trimmedTarget)
  }

  const valid = await verifyCode(trimmedTarget, code, "login")
  if (!valid) {
    await recordLoginFailure(trimmedTarget, client)
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 })
  }
  await clearLoginFailures(trimmedTarget, client)

  const pool = getPool()
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedTarget)
  const lookupField = isEmail ? "email" : "phone"

  const result = await pool.query<DbUser>(
    `
    select
      id::text,
      email,
      phone,
      password_hash,
      name,
      coalesce(role, 'member') as role,
      status::text as status
    from users
    where ${lookupField} = $1
      and deleted_at is null
    limit 1
    `,
    [trimmedTarget]
  )

  let user = result.rows[0]

  if (!user) {
    const roleId = await getDefaultRoleId()
    const insertResult = await pool.query<DbUser>(
      `
      insert into users (
        created_by, updated_by, status, name, ${lookupField}, role_id, role
      )
      values ($1, $1, 'active', $2, $3, $4::uuid, 'member')
      returning
        id::text,
        email,
        phone,
        password_hash,
        name,
        coalesce(role, 'member') as role,
        status::text as status
      `,
      [
        "00000000-0000-0000-0000-000000000000",
        isEmail ? trimmedTarget.split("@")[0] : trimmedTarget,
        trimmedTarget,
        roleId,
      ]
    )
    user = insertResult.rows[0]
  } else if (user.status !== "active") {
    return NextResponse.json({ error: "账号已被禁用" }, { status: 403 })
  }

  const initialAdmin = process.env.AUTH_INITIAL_ADMIN
  if (initialAdmin && trimmedTarget === initialAdmin) {
    await pool.query(`update users set role = 'admin' where id = $1`, [user.id])
    user.role = "admin"
  }

  return issueSession(user)
}

async function issueSession(user: DbUser): Promise<NextResponse> {
  await getPool().query(`update users set last_login_at = now() where id = $1`, [
    user.id,
  ])

  const authUser: AuthUser = {
    userId: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name || user.email || user.phone || "用户",
    role: user.role,
  }

  const token = await signSessionToken(authUser)
  await setSessionCookie(token)

  return NextResponse.json({ user: authUser, message: "登录成功" })
}

async function issueLocalSession(target: string): Promise<NextResponse> {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  const authUser: AuthUser = {
    userId: "local-admin",
    email: isEmail ? target : "local-admin@example.com",
    phone: isEmail ? null : target,
    name: "本地管理员",
    role: "admin",
  }
  const token = await signSessionToken(authUser)
  await setSessionCookie(token)

  return NextResponse.json({
    user: authUser,
    message: "本地登录成功",
  })
}

/** 超过次数就返回 429，并带上要等多久；正常情况返回 null。 */
async function tooManyAttempts(target: string, client: string): Promise<NextResponse | null> {
  const status = await checkLoginAllowed(target, client)
  if (status.allowed) return null
  return NextResponse.json(
    { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: status.retryAfterSeconds, message: `尝试次数过多，请 ${Math.ceil(status.retryAfterSeconds / 60)} 分钟后再试` },
    { status: 429, headers: { "Retry-After": String(status.retryAfterSeconds) } }
  )
}

function isLocalAuthFallbackEnabled() {
  return process.env.NODE_ENV === "development" && !hasDatabaseUrl()
}

async function getDefaultRoleId() {
  const result = await getPool().query<{ id: string }>(
    `
    select id::text
    from roles
    where deleted_at is null
      and key in ('member', 'sales', 'owner')
    order by case key when 'member' then 1 when 'sales' then 2 else 3 end
    limit 1
    `
  )

  return result.rows[0]?.id ?? "10000000-0000-0000-0000-000000000021"
}
