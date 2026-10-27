import { NextRequest, NextResponse } from "next/server"
import { checkSendCodeAllowed } from "@/lib/login-guard"
import { generateAndSendCode } from "@/lib/verification"
import type { CodeType } from "@/lib/verification"
import { SELF_SIGNUP_CLOSED_MESSAGE, selfSignupAllowed } from "@/lib/self-signup"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const target = String(body.target ?? "").trim()
    const type = (body.type as CodeType) ?? "login"

    if (!target) {
      return NextResponse.json({ error: "请输入邮箱或手机号" }, { status: 400 })
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
    const isPhone = /^1[3-9]\d{9}$/.test(target)

    if (!isEmail && !isPhone) {
      return NextResponse.json({ error: "请输入有效的邮箱或手机号" }, { status: 400 })
    }

    if (type === "register" && !selfSignupAllowed()) {
      return NextResponse.json({ error: SELF_SIGNUP_CLOSED_MESSAGE }, { status: 403 })
    }

    if (!["login", "register", "reset-password"].includes(type)) {
      return NextResponse.json({ error: "无效的验证码类型" }, { status: 400 })
    }

    // 同一个目标一小时最多 5 条：接了真实短信/邮件之后，这一条直接是钱。
    const throttled = await checkSendCodeAllowed(target)
    if (!throttled.allowed) {
      return NextResponse.json(
        {
          error: "TOO_MANY_REQUESTS",
          retryAfterSeconds: throttled.retryAfterSeconds,
          message: `验证码发得太频繁，请 ${Math.ceil(throttled.retryAfterSeconds / 60)} 分钟后再试`,
        },
        { status: 429, headers: { "Retry-After": String(throttled.retryAfterSeconds) } }
      )
    }

    const result = await generateAndSendCode(target, type)

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "发送失败" }, { status: 429 })
    }

    return NextResponse.json({
      message: "验证码已发送",
      code: result.code, // Only present when AUTH_DEV_MODE=true
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SEND_CODE_FAILED" },
      { status: 500 }
    )
  }
}
