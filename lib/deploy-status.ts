import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

/**
 * 设备版的部署状态读取（只读，不连网、不触发任何更新）。
 *
 * 更新、备份、版本检查都在宿主机侧执行（ADR 0010：业务应用不持有 docker socket），
 * 它们把结果写成 JSON 放在 `deploy-state/`；设备版编排把这个目录只读挂进容器，
 * 管理员页面读文件展示。这里是唯一的读取入口，页面不要自己拼路径。
 */

export type DeployCheck = {
  checkedAt: string
  currentVersion: string | null
  error: string | null
  latestVersion: string | null
  signature: string
  source: string | null
  updateAvailable: boolean
}

export type DeployUpdate = {
  failedStep: string | null
  finishedAt: string | null
  startedAt: string | null
  status: string
  target: string
}

export type DeployBackup = {
  createdAt: string
  error: string | null
  kept: number | null
  label: string
  ok: boolean
  version: string
}

export type DeployStatus = {
  available: boolean
  backup: DeployBackup | null
  check: DeployCheck | null
  update: DeployUpdate | null
}

type ReadFile = (path: string, encoding: "utf8") => Promise<string>

export type DeployStatusDependencies = {
  env?: Record<string, string | undefined>
  readFile?: ReadFile
}

const STATE_DIR_ENV = "FMKJ_DEPLOY_STATE_DIR"
const DEFAULT_STATE_DIR = "/data/deploy-state"

export function deployStateDir(env: Record<string, string | undefined> = process.env): string {
  const configured = (env[STATE_DIR_ENV] ?? "").trim()
  return configured || DEFAULT_STATE_DIR
}

/**
 * 失败原因来自宿主机脚本，可能带绝对路径。页面只展示原因，不展示这台机器的目录结构。
 */
export function redactDetail(value: unknown): string | null {
  const text = String(value ?? "").replace(/(?:[A-Za-z]:)?[\\/][^\s"'`,;)]*/g, "…").replace(/\s+/g, " ").trim()
  return text ? text.slice(0, 240) : null
}

async function readJson(path: string, read: ReadFile): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await read(path, "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim()
  return result || null
}

export async function getDeployStatus(dependencies: DeployStatusDependencies = {}): Promise<DeployStatus> {
  const env = dependencies.env ?? process.env
  const read = dependencies.readFile ?? ((path, encoding) => readFile(path, encoding))
  const dir = deployStateDir(env)

  const [check, update, backup] = await Promise.all([
    readJson(resolve(dir, "update-check.json"), read),
    readJson(resolve(dir, "update-state.json"), read),
    readJson(resolve(dir, "backup-state.json"), read),
  ])

  const available = Boolean(check || update || backup)
  const steps = Array.isArray(update?.steps) ? (update?.steps as Array<Record<string, unknown>>) : []
  const failed = steps.find((step) => step.status === "failed")

  return {
    available,
    backup: backup
      ? {
        createdAt: text(backup.createdAt) ?? "",
        error: redactDetail(backup.error),
        kept: typeof backup.kept === "number" ? backup.kept : null,
        label: text(backup.label) ?? "",
        ok: backup.ok !== false,
        version: text(backup.version) ?? "",
      }
      : null,
    check: check
      ? {
        checkedAt: text(check.checkedAt) ?? "",
        currentVersion: text(check.currentVersion),
        error: redactDetail(check.error),
        latestVersion: text(check.latestVersion),
        signature: text(check.signature) ?? "",
        source: text(check.source),
        updateAvailable: check.updateAvailable === true,
      }
      : null,
    update: update
      ? {
        failedStep: text(failed?.id),
        finishedAt: text(update.finishedAt),
        startedAt: text(update.startedAt),
        status: text(update.status) ?? "unknown",
        target: text(update.target) ?? "",
      }
      : null,
  }
}
