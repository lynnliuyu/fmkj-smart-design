import { NextRequest, NextResponse } from "next/server"
import { generateAndSendCode } from "@/lib/verification"
import type { CodeType } from "@/lib/verification"

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

    if (!["login", "register", "reset-password"].includes(type)) {
      return NextResponse.json({ error: "无效的验证码类型" }, { status: 400 })
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
