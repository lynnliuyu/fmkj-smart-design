import { NextRequest, NextResponse } from "next/server"

import { signSessionToken, setSessionCookie } from "@/lib/auth"
import { createFirstAdmin, FirstRunError, getFirstRunState, validateFirstAdmin } from "@/lib/first-run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 设备首次初始化：客户自己设管理员账号。
 *
 * 只有从未初始化且没有账号/客户业务资料的空库才允许创建；
 * 已经初始化过的设备再调这个接口会被拒。装机脚本也靠 GET 判断设备是否还没初始化。
 */

export async function GET() {
  return NextResponse.json(await getFirstRunState())
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "请求内容不是有效的 JSON" }, { status: 400 })
  }

  const state = await getFirstRunState()
  if (!state.databaseReady) {
    return NextResponse.json({ error: "DATABASE_UNAVAILABLE", message: "数据库还没准备好，请稍后重试。" }, { status: 503 })
  }
  if (!state.needsSetup) {
    return NextResponse.json({ error: "ALREADY_INITIALIZED", message: "这台设备已经初始化过了，请直接登录。" }, { status: 409 })
  }

  const invalid = validateFirstAdmin(body as never)
  if (invalid) return NextResponse.json({ error: "INVALID_INPUT", message: invalid }, { status: 400 })

  try {
    const admin = await createFirstAdmin({
      email: String(body.email ?? ""),
      name: String(body.name ?? ""),
      password: String(body.password ?? ""),
    })
    // 建完直接登录，客户不用再输一次。
    const token = await signSessionToken({ email: admin.email, name: admin.name, phone: null, role: "admin", userId: admin.userId })
    await setSessionCookie(token)
    return NextResponse.json({ ok: true, email: admin.email, next: "/projects" }, { status: 201 })
  } catch (error) {
    if (error instanceof FirstRunError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "SETUP_FAILED", message: error instanceof Error ? error.message : "初始化失败，请重试" },
      { status: 500 },
    )
  }
}
