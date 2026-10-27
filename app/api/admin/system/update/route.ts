import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import {
  clearUpdateRequest,
  deployStateDirectoryFor,
  isDeployVersion,
  readAgentState,
  readUpdateRequest,
  readUpdateStatus,
  REQUEST_STALE_MS,
  writeUpdateRequest,
} from "@/lib/deploy-update"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 在线更新：页面侧只负责「请求」和「看进度」。
 *
 * 应用不持有 docker socket，也不执行宿主机命令（ADR 0010）；真正安装的是设备上的更新管家，
 * 它读 deploy-state 里的请求文件、跑既有的更新脚本、把结果写回来。这里做的是三件事：
 * 校验请求合法（只允许更新到「检查到的最新版本」）、把请求落盘、把状态读给页面。
 */

export async function GET() {
  try {
    await requireSuperAdmin()
  } catch (error) {
    return adminApiErrorResponse(error)
  }
  return NextResponse.json(await readUpdateStatus())
}

export async function POST(request: NextRequest) {
  let actor = ""
  try {
    actor = (await requireSuperAdmin()).user.userId
  } catch (error) {
    return adminApiErrorResponse(error)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "请求内容不是有效的 JSON" }, { status: 400 })
  }

  const action = body.action === "update" ? "update" : body.action === "check" ? "check" : ""
  if (!action) {
    return NextResponse.json({ error: "UNKNOWN_ACTION", message: "只支持检查更新和安装更新两种操作" }, { status: 400 })
  }

  const stateDir = deployStateDirectoryFor()
  const status = await readUpdateStatus({ stateDir })
  const pending = await readUpdateRequest(stateDir)
  const agent = await readAgentState(stateDir)

  if (agent?.status === "running" && agent.startedAt && Date.now() - Date.parse(agent.startedAt) < 30 * 60 * 1000) {
    return NextResponse.json({ error: "UPDATE_IN_PROGRESS", message: "设备正在执行更新，请等它结束。" }, { status: 409 })
  }
  if (pending && !pending.expired && pending.ageMs < REQUEST_STALE_MS) {
    return NextResponse.json({ error: "REQUEST_PENDING", message: "上一条请求还在排队，请稍等一下。" }, { status: 409 })
  }
  if (pending) await clearUpdateRequest(stateDir)

  if (action === "check") {
    await writeUpdateRequest(stateDir, { action: "check", requestedBy: actor })
    return NextResponse.json({ ...(await readUpdateStatus({ stateDir })), message: "已请求检查更新。" })
  }

  const target = String(body.to ?? "").trim()
  if (!isDeployVersion(target)) {
    return NextResponse.json({ error: "VERSION_INVALID", message: "版本号格式不对。" }, { status: 400 })
  }
  const check = status.check
  if (!check?.checkedAt) {
    return NextResponse.json({ error: "CHECK_REQUIRED", message: "先点一次「检查更新」，再安装。" }, { status: 400 })
  }
  if (target === status.currentVersion) {
    return NextResponse.json({ error: "ALREADY_CURRENT", message: `这台设备已经在跑 ${target} 了。` }, { status: 400 })
  }
  if (!check.updateAvailable || check.latestVersion !== target) {
    return NextResponse.json(
      {
        error: "VERSION_NOT_OFFERED",
        message: check.updateAvailable
          ? `只能更新到检查到的最新版本 ${check.latestVersion ?? ""}。请重新检查一次。`
          : "当前已经是最新版本。",
      },
      { status: 400 },
    )
  }

  await writeUpdateRequest(stateDir, { action: "update", requestedBy: actor, to: target })
  return NextResponse.json({ ...(await readUpdateStatus({ stateDir })), message: `已请求更新到 ${target}。` })
}
