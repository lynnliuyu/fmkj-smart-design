import type { PointMapProcurementPreviewResponse } from "./point-map-procurement"
import { writePointMapQuoteSnapshot } from "./quote-draft"

export type QuoteRefreshResult =
  | { updated: true; included: number; excluded: number; unverified: number }
  | { updated: false; message: string }

/** 保存草稿会等待这次同步，超时上限保证数据库卡住时按钮和编辑器不会一直锁死。 */
export const POINT_MAP_QUOTE_REFRESH_TIMEOUT_MS = 20_000

function timeoutSignal(ms: number) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined
}

/**
 * 按项目最新已保存的点位方案重新计算报价快照，并通知报价页合并。
 * 只更新本机预览，不保存数据库报价；阻塞或项目切换时保留原预览。
 */
export async function refreshPointMapQuote(projectId: string, projectName: string, options: {
  expectedRevision?: number
  isCurrent?: () => boolean
  fetcher?: typeof fetch
  publish?: typeof writePointMapQuoteSnapshot
  timeoutMs?: number
} = {}): Promise<QuoteRefreshResult> {
  const fetcher = options.fetcher ?? fetch
  const signal = timeoutSignal(options.timeoutMs ?? POINT_MAP_QUOTE_REFRESH_TIMEOUT_MS)
  const base = `/api/projects/${encodeURIComponent(projectId)}/point-map`
  try {
  let revision = options.expectedRevision
  if (revision === undefined) {
    const current = await fetcher(base, { cache: "no-store", ...(signal ? { signal } : {}) })
    if (!current.ok) return { updated: false, message: "无法读取已保存点位，请刷新后重试。" }
    revision = ((await current.json()) as { revision?: number }).revision
  }
  if (!Number.isSafeInteger(revision) || !revision || revision < 1) return { updated: false, message: "请先保存点位方案。" }
  const response = await fetcher(`${base}/quote-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: revision }),
    ...(signal ? { signal } : {}),
  })
  const result = (await response.json()) as PointMapProcurementPreviewResponse & { error?: string }
  if (!response.ok) return { updated: false, message: result.error || "报价来源核对失败，请重新保存点位后重试。" }
  if (result.blocked) return { updated: false, message: `有 ${result.diagnostics?.length ?? 0} 个点位的资料需要核对。` }
  if (!result.data || result.data.projectId !== projectId || result.data.revision !== revision || !Array.isArray(result.data.items)) {
    return { updated: false, message: "报价预览的项目或版本不对应，未替换原预览。" }
  }
  if (options.isCurrent && !options.isCurrent()) return { updated: false, message: "项目或版本已切换，未替换原预览。" }
  ;(options.publish ?? writePointMapQuoteSnapshot)({
    ...result.data,
    // 本机报价编辑格式需要数值；无权查看成本时只填占位值，真实成本由服务端保存时恢复。
    items: result.data.items.map((item) => ({ ...item, cost: item.cost ?? 0, project: projectName })),
  })
  return { updated: true, included: result.included, excluded: result.excluded, unverified: result.unverified?.length ?? 0 }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      return { updated: false, message: "报价预览同步超时，请稍后再次保存草稿重试。" }
    return { updated: false, message: error instanceof Error ? error.message : "报价预览更新失败，请重试。" }
  }
}
