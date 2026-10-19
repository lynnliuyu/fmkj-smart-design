import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/server-db"
import { verifyCode } from "@/lib/verification"
import bcrypt from "bcryptjs"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const target = String(body.target ?? "").trim()
    const code = String(body.code ?? "")
    const newPassword = String(body.newPassword ?? "")

    if (!target || !code || !newPassword) {
      return NextResponse.json({ error: "请填写所有字段" }, { status: 400 })
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "密码至少6位" }, { status: 400 })
    }

    const valid = await verifyCode(target, code, "reset-password")
    if (!valid) {
      return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 })
    }

    const pool = getPool()
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
    const lookupField = isEmail ? "email" : "phone"

    const result = await pool.query(
      `SELECT id::text FROM users WHERE ${lookupField} = $1 AND status = 'active'`,
      [target]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "未找到该账号" }, { status: 404 })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [passwordHash, result.rows[0].id]
    )

    return NextResponse.json({ message: "密码已重置，请使用新密码登录" })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RESET_FAILED" },
      { status: 500 }
    )
  }
}
