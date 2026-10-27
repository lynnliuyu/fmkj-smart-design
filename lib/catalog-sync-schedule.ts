import { applyCatalogSync } from "./catalog-sync-service"
import { catalogSyncConfig, catalogSyncReady } from "./catalog-sync"

/**
 * 官方产品资料的定时同步。
 *
 * 为什么放在应用进程里而不是宿主机 systemd：设备版一共就一个应用容器，而同步要用的
 * 是应用内的产品写入服务（校验、审计、映射版本都在这层）。放进程里意味着**不需要客户在
 * 设备上装任何定时任务、也不需要给网页接口开第二个凭据**。
 *
 * 代价说清楚：进程重启后重新计时，重启期间不跑；多实例部署时会各自跑一遍
 * （设备版是单实例，托管版要接这个功能得先想清楚去重）。同步本身是幂等的：
 * 已有的货号默认不覆盖，重复跑不会重复建产品也不会改坏本地价格。
 */

export const DEFAULT_SYNC_INTERVAL_HOURS = 24
/** 启动后先等一会再跑第一次：别和首屏请求抢资源，也避开滚动更新的启动窗口。 */
export const DEFAULT_STARTUP_DELAY_MINUTES = 5

export type SyncSchedule = {
  intervalMs: number
  startupDelayMs: number
}

/** 只在配齐了官方资料、且没被显式关掉时才排期。 */
export function planSyncSchedule(env: Record<string, string | undefined> = process.env): SyncSchedule | null {
  const config = catalogSyncConfig(env)
  if (!catalogSyncReady(config)) return null
  if (String(env.UPSTREAM_SYNC_ENABLED ?? "true").toLowerCase() === "false") return null

  const hours = Number(env.UPSTREAM_SYNC_INTERVAL_HOURS ?? DEFAULT_SYNC_INTERVAL_HOURS)
  const minutes = Number(env.UPSTREAM_SYNC_STARTUP_DELAY_MINUTES ?? DEFAULT_STARTUP_DELAY_MINUTES)
  return {
    intervalMs: (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SYNC_INTERVAL_HOURS) * 3600_000,
    startupDelayMs: (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_STARTUP_DELAY_MINUTES) * 60_000,
  }
}

export type SyncScheduleDependencies = {
  apply?: typeof applyCatalogSync
  env?: Record<string, string | undefined>
  log?: (message: string) => void
  setInterval?: (handler: () => void, ms: number) => unknown
  setTimeout?: (handler: () => void, ms: number) => unknown
}

let started = false

/**
 * 排一次日常同步。返回是否真的排上了（没配官方资料时返回 false，什么都不做）。
 * 用 `started` 兜住重复注册：Next 在开发模式下可能多次调用 register()。
 */
export function startCatalogSyncSchedule(dependencies: SyncScheduleDependencies = {}): boolean {
  const env = dependencies.env ?? process.env
  const plan = planSyncSchedule(env)
  if (!plan || started) return false
  started = true

  const log = dependencies.log ?? ((message: string) => console.log(message))
  const schedule = dependencies.setTimeout ?? setTimeout
  const repeat = dependencies.setInterval ?? setInterval
  const apply = dependencies.apply ?? applyCatalogSync

  const run = async (trigger: string) => {
    try {
      const result = await apply(null, {}, { updateExisting: false })
      const counts = result.result
      log(`[catalog-sync] ${trigger}：新增 ${counts?.created ?? 0}、更新 ${counts?.updated ?? 0}、跳过 ${counts?.skipped ?? 0}、失败 ${counts?.failed ?? 0}`)
    } catch (error) {
      // 定时同步失败不能影响应用本身：本地资料继续可用，原因已记进 catalog_sync_runs。
      log(`[catalog-sync] ${trigger}失败：${error instanceof Error ? error.message : error}`)
    }
  }

  schedule(() => { void run("启动后首次同步") }, plan.startupDelayMs)
  repeat(() => { void run("定时同步") }, plan.intervalMs)
  log(`[catalog-sync] 已排期：启动 ${Math.round(plan.startupDelayMs / 60000)} 分钟后首次同步，之后每 ${Math.round(plan.intervalMs / 3600000)} 小时一次（只补新品，不覆盖本地）`)
  return true
}

/** 测试用：允许重新排期。 */
export function resetCatalogSyncSchedule() {
  started = false
}
