import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { deployStateDir, getDeployStatus, type DeployStatus } from "./deploy-status"

/**
 * 「在线更新」的请求协议：页面只写一个请求文件，设备上的更新管家看到就代跑。
 *
 * 为什么不是应用直接更新：ADR 0010 规定业务容器不持有 docker socket、不能执行宿主机命令。
 * 所以应用能做的只有两件事——把「我想装 v0.2.0」写成文件，以及读管家写回来的结果。
 * 请求文件里只有版本号，管家也只认版本号；即使网页被攻破，也只能触发一次「装某个正式版本」，
 * 不能变成任意命令执行。
 */

/**
 * 请求放在 stateDir 下的 requests/ 子目录：这个子目录属于应用用户（uid 1001），
 * 应用只能动这里；管家的状态与日志在上一层（root 拥有），应用读得到、改不了。
 */
export const REQUEST_DIR_NAME = "requests"
export const REQUEST_FILE_NAME = "update-request.json"
export const RUNNING_FILE_NAME = "update-request.running.json"
export const AGENT_STATE_FILE_NAME = "updater-state.json"

/** 版本号格式：与 build-release.mjs 保持一致，避免两边对不上。 */
export const VERSION_PATTERN = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

/** 请求超过这个时间还没被管家取走，就认为管家没装或没在跑。 */
export const REQUEST_STALE_MS = 3 * 60 * 1000
/** 超过这个时间的旧请求不再执行：断电重启后不该翻出昨天的请求自己装一遍。 */
export const REQUEST_EXPIRY_MS = 30 * 60 * 1000

export type UpdateAction = "check" | "update"

export type UpdateRequest = {
  action: UpdateAction
  id: string
  requestedAt: string
  requestedBy: string
  to: string | null
}

export type UpdaterAgentState = {
  action: UpdateAction
  finishedAt: string
  id: string
  message: string | null
  startedAt: string
  status: string
  target: string | null
}

export function isDeployVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value.trim())
}

export function updateRequestDir(stateDir: string): string {
  return resolve(stateDir, REQUEST_DIR_NAME)
}

export function updateRequestPath(stateDir: string): string {
  return resolve(stateDir, REQUEST_DIR_NAME, REQUEST_FILE_NAME)
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim()
  return result || null
}

function readJsonFile(read: (path: string) => Promise<string>, path: string): Promise<Record<string, unknown> | null> {
  return read(path)
    .then((content) => {
      const parsed = JSON.parse(content)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    })
    .catch(() => null)
}

/**
 * 读当前请求。返回 null 表示没有请求；`expired` 为真表示请求太旧、管家不会执行了。
 */
export async function readUpdateRequest(
  stateDir: string,
  dependencies: { now?: Date; read?: (path: string) => Promise<string> } = {},
): Promise<(UpdateRequest & { ageMs: number; expired: boolean }) | null> {
  const read = dependencies.read ?? ((path: string) => readFile(path, "utf8"))
  const now = dependencies.now ?? new Date()
  const parsed = await readJsonFile(read, updateRequestPath(stateDir))
  if (!parsed) return null

  const action = parsed.action === "update" ? "update" : "check"
  const requestedAt = text(parsed.requestedAt) ?? ""
  const requested = Date.parse(requestedAt)
  const ageMs = Number.isFinite(requested) ? Math.max(0, now.getTime() - requested) : Number.POSITIVE_INFINITY
  return {
    action,
    ageMs,
    expired: ageMs > REQUEST_EXPIRY_MS,
    id: text(parsed.id) ?? "",
    requestedAt,
    requestedBy: text(parsed.requestedBy) ?? "",
    to: isDeployVersion(parsed.to) ? String(parsed.to).trim() : null,
  }
}

/** 读管家写回来的执行结果；没有就是 null（管家没装或还没跑过）。 */
export async function readAgentState(
  stateDir: string,
  dependencies: { read?: (path: string) => Promise<string> } = {},
): Promise<UpdaterAgentState | null> {
  const read = dependencies.read ?? ((path: string) => readFile(path, "utf8"))
  const parsed = await readJsonFile(read, resolve(stateDir, AGENT_STATE_FILE_NAME))
  if (!parsed) return null
  return {
    action: parsed.action === "update" ? "update" : "check",
    finishedAt: text(parsed.finishedAt) ?? "",
    id: text(parsed.id) ?? "",
    message: text(parsed.message),
    startedAt: text(parsed.startedAt) ?? "",
    status: text(parsed.status) ?? "unknown",
    target: text(parsed.target),
  }
}

/**
 * 写请求（先写临时文件再改名，避免管家读到写了一半的内容）。
 * 由调用方先做业务校验：这里只负责把合法的东西落盘。
 */
export async function writeUpdateRequest(
  stateDir: string,
  input: { action: UpdateAction; requestedBy: string; to?: string | null },
  dependencies: { now?: Date } = {},
): Promise<UpdateRequest> {
  const now = dependencies.now ?? new Date()
  const request: UpdateRequest = {
    action: input.action,
    id: randomUUID(),
    requestedAt: now.toISOString(),
    requestedBy: input.requestedBy.slice(0, 120),
    to: input.action === "update" ? String(input.to ?? "").trim() : null,
  }
  if (request.action === "update" && !isDeployVersion(request.to)) {
    throw new Error("UPDATE_TARGET_INVALID")
  }

  const target = updateRequestPath(stateDir)
  const temporary = `${target}.${request.id}.tmp`
  await mkdir(updateRequestDir(stateDir), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", mode: 0o644 })
  await rename(temporary, target)
  return request
}

/** 页面要展示的一句话状态；判断顺序：正在跑 → 待执行 → 结果。 */
export function describeUpdateProgress(input: {
  agent: UpdaterAgentState | null
  checkStale: boolean
  request: { action: UpdateAction; ageMs: number; id: string; to: string | null } | null
}): { message: string; tone: "info" | "warn" | "ok" | "error"; busy: boolean } {
  const { agent, request } = input

  if (agent && agent.status === "running" && agent.id === request?.id) {
    return {
      busy: true,
      message: agent.action === "update"
        ? `正在更新到 ${agent.target ?? ""}：备份 → 拉镜像 → 升级数据库 → 切换 → 自检。这一两分钟页面会打不开，请勿断电。`
        : "正在检查有没有新版本…",
      tone: "info",
    }
  }

  if (request) {
    if (request.action === "update" && request.ageMs > REQUEST_STALE_MS) {
      return {
        busy: false,
        message: "已请求更新，但设备上的更新管家没有响应。请确认设备上的更新服务在运行（或联系技术支持）。",
        tone: "warn",
      }
    }
    return {
      busy: true,
      message: request.action === "update" ? `已请求更新到 ${request.to ?? ""}，等待设备执行…` : "已请求检查，等待设备执行…",
      tone: "info",
    }
  }

  if (agent && agent.status === "running") {
    return { busy: true, message: "设备正在执行上一次请求…", tone: "info" }
  }
  if (agent && agent.status === "failed-needs-restore") {
    return {
      busy: false,
      message: `更新失败，且数据库结构已经变化，需要恢复备份：${agent.message ?? "请查看设备日志"}。不要切回旧版本。`,
      tone: "error",
    }
  }
  if (agent && agent.status === "failed") {
    return { busy: false, message: `上次更新失败：${agent.message ?? "请查看设备日志"}（旧版本仍在服务）`, tone: "error" }
  }
  if (agent && agent.status === "succeeded" && agent.action === "update") {
    return { busy: false, message: `已完成更新到 ${agent.target ?? ""}。`, tone: "ok" }
  }
  if (input.checkStale) {
    return { busy: false, message: "还没有检查过版本。点「检查更新」看看有没有新版本。", tone: "info" }
  }
  return { busy: false, message: "没有正在进行的更新。", tone: "info" }
}

export type UpdateStatus = {
  agent: UpdaterAgentState | null
  check: DeployStatus["check"]
  currentVersion: string | null
  progress: { busy: boolean; message: string; tone: "info" | "warn" | "ok" | "error" }
  request: (UpdateRequest & { ageMs: number; expired: boolean }) | null
  update: DeployStatus["update"]
}

/**
 * 页面与接口共用的状态组装：读版本检查、当前请求、管家结果，合成一句话进度。
 * 服务端渲染直接调用它，页面首屏就有内容，不用先让浏览器再问一次。
 */
export async function readUpdateStatus(
  dependencies: { currentVersion?: string; stateDir?: string } = {},
): Promise<UpdateStatus> {
  const stateDir = dependencies.stateDir ?? deployStateDir()
  const [deploy, request, agent] = await Promise.all([
    getDeployStatus(),
    readUpdateRequest(stateDir),
    readAgentState(stateDir),
  ])
  // 正在跑的版本以容器自己的环境变量为准：检查结果里的「当前版本」是上一次检查时的快照，
  // 更新完就会过期，用它判断会出现「更新到已经在跑的版本」这种空转。
  const currentVersion = (dependencies.currentVersion || process.env.FMKJ_VERSION || "").trim() || deploy.check?.currentVersion || null
  return {
    agent,
    check: deploy.check,
    currentVersion,
    progress: describeUpdateProgress({ agent, checkStale: !deploy.check?.checkedAt, request }),
    request,
    update: deploy.update,
  }
}

/** 清掉请求文件（管家执行完会自己清；这里的兜底用于测试与手工排障）。 */
export async function clearUpdateRequest(stateDir: string): Promise<void> {
  await unlink(updateRequestPath(stateDir)).catch(() => undefined)
}

export function deployStateDirectoryFor(env: Record<string, string | undefined> = process.env): string {
  return deployStateDir(env)
}
