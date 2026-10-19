import bcrypt from "bcryptjs"
import { NextRequest, NextResponse } from "next/server"

import { signSessionToken, setSessionCookie, type AuthUser } from "@/lib/auth"
import { getPool, hasDatabaseUrl } from "@/lib/server-db"

type DbUser = {
  id: string
  email: string | null
  phone: string | null
  name: string
  role: string
  status: string
}

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "")

    if (!name || !email || !password) {
      return NextResponse.json({ error: "请填写姓名、邮箱和密码" }, { status: 400 })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "请输入有效的邮箱" }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 })
    }

    if (process.env.NODE_ENV === "development" && !hasDatabaseUrl()) {
      const authUser: AuthUser = {
        userId: "local-admin",
        email,
        phone: null,
        name,
        role: "admin",
      }
      const token = await signSessionToken(authUser)
      await setSessionCookie(token)

      return NextResponse.json({ user: authUser, message: "本地注册成功" })
    }

    const pool = getPool()
    const existing = await pool.query<{ id: string }>(
      `
      select id::text
      from users
      where lower(email) = $1
        and deleted_at is null
      limit 1
      `,
      [email]
    )

    if (existing.rows[0]) {
      return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 409 })
    }

    const roleId = await getDefaultRoleId()
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await pool.query<DbUser>(
      `
      insert into users (
        created_by,
        updated_by,
        status,
        name,
        email,
        password_hash,
        role_id,
        role,
        last_login_at
      )
      values ($1, $1, 'active', $2, $3, $4, $5::uuid, 'member', now())
      returning
        id::text,
        email,
        phone,
        name,
        coalesce(role, 'member') as role,
        status::text as status
      `,
      [SYSTEM_USER_ID, name, email, passwordHash, roleId]
    )

    const user = result.rows[0]
    const authUser: AuthUser = {
      userId: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
    }

    const token = await signSessionToken(authUser)
    await setSessionCookie(token)

    return NextResponse.json({ user: authUser, message: "注册成功" })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 500 }
    )
  }
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
