import { getPool } from "./server-db"

export type CodeType = "login" | "register" | "reset-password"

const CODE_EXPIRY_MINUTES = 5
const MAX_CODES_PER_HOUR = 5

export async function generateAndSendCode(
  target: string,
  type: CodeType
): Promise<{ success: boolean; code?: string; error?: string }> {
  const pool = getPool()

  const recentResult = await pool.query(
    `SELECT count(*)::int as count FROM verification_codes
     WHERE target = $1 AND created_at > now() - interval '1 hour'`,
    [target]
  )

  if (recentResult.rows[0].count >= MAX_CODES_PER_HOUR) {
    return { success: false, error: "发送次数过多，请 1 小时后再试" }
  }

  await pool.query(
    `UPDATE verification_codes SET used_at = now()
     WHERE target = $1 AND type = $2 AND used_at IS NULL AND expires_at > now()`,
    [target, type]
  )

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000)

  await pool.query(
    `INSERT INTO verification_codes (target, code, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [target, code, type, expiresAt.toISOString()]
  )

  const isDevMode =
    process.env.NODE_ENV === "development" || process.env.AUTH_DEV_MODE === "true"

  if (isDevMode) {
    console.log(`[AUTH DEV] Verification code for ${target}: ${code}`)
    return { success: true, code }
  }

  console.warn(
    `[AUTH] No SMS/email provider configured. Code ${code} for ${target} was NOT sent. Set AUTH_DEV_MODE=true for testing.`
  )

  return { success: false, error: "短信/邮件服务未配置，请设置 AUTH_DEV_MODE=true 进行测试" }
}

export async function verifyCode(
  target: string,
  code: string,
  type: CodeType
): Promise<boolean> {
  const pool = getPool()

  const result = await pool.query(
    `SELECT id FROM verification_codes
     WHERE target = $1 AND code = $2 AND type = $3
       AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [target, code, type]
  )

  if (result.rows.length === 0) {
    return false
  }

  await pool.query(`UPDATE verification_codes SET used_at = now() WHERE id = $1`, [
    result.rows[0].id,
  ])

  return true
}
