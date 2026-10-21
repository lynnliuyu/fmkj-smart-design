/**
 * 设计站 → 我方托管 CAD 导入服务 的服务端客户端。
 *
 * 令牌只在服务端环境变量里，绝不下发浏览器、不写进 URL、不进日志。
 * 这个模块只做 HTTP；权限、写库、冲突检查复用设计站既有的点位服务。
 */
import { parsePointMapDraft, importPointMapDraft, type PointMapDraft } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"

export const CAD_IMPORT_TIMEOUT_MS = 15 * 60_000
export const CAD_IMPORT_POLL_MS = 3_000
export const CAD_IMPORT_MAX_BYTES = 100 * 1024 * 1024

export type CadImportConfig = { baseUrl: string; token: string }

export class CadImportError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = "CadImportError"
    this.code = code
    this.status = status
  }
}

/** 从环境变量读配置；未配置时返回 null，路由据此返回明确的“未接入”错误而不是 500。 */
export function cadImportConfig(env: NodeJS.ProcessEnv = process.env): CadImportConfig | null {
  const baseUrl = (env.CAD_IMPORT_SERVICE_URL ?? "").trim()
  const token = (env.CAD_IMPORT_SERVICE_TOKEN ?? "").trim()
  if (!baseUrl || !token) return null
  if (token.length < 32) throw new CadImportError("CAD_IMPORT_BAD_TOKEN", "CAD_IMPORT_SERVICE_TOKEN 少于 32 字符。", 500)
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new CadImportError("CAD_IMPORT_BAD_URL", "CAD_IMPORT_SERVICE_URL 不是合法地址。", 500)
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new CadImportError("CAD_IMPORT_BAD_URL", "CAD_IMPORT_SERVICE_URL 只支持 http/https。", 500)
  return { baseUrl: parsed.origin + parsed.pathname.replace(/\/$/, ""), token }
}

type RequestOptions = {
  filename: string
  bytes: Uint8Array
  space?: string
  floorName?: string
  signal?: AbortSignal
}

type ImportResult = { id: string; status: string; statusUrl?: string; error?: string; result?: { draftUrl?: string } }

/** 上传并轮询到结束，返回草稿 JSON（已用设计站解析器校验）。 */
export async function requestCadImport(config: CadImportConfig, options: RequestOptions): Promise<{ draft: PointMapDraft; id: string }> {
  const query = new URLSearchParams({ filename: options.filename })
  if (options.space) query.set("space", options.space)
  if (options.floorName) query.set("floorName", options.floorName)
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/v1/cad-imports?${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/octet-stream" },
      // Uint8Array 在 Node 运行时可直接作为流式 body，但 DOM 类型不认，转成 Buffer 视图。
      body: options.bytes as unknown as BodyInit,
      signal: options.signal,
    })
  } catch {
    throw new CadImportError("CAD_IMPORT_UNREACHABLE", "无法连接 CAD 导入服务，请检查网络或服务地址。")
  }
  if (response.status === 401 || response.status === 403) throw new CadImportError("CAD_IMPORT_UNAUTHORIZED", "CAD 导入服务拒绝了凭据，请检查服务端令牌配置。")
  if (response.status === 413) throw new CadImportError("CAD_IMPORT_TOO_LARGE", "CAD 文件超过导入服务大小限制。", 413)
  if (response.status === 429) throw new CadImportError("CAD_IMPORT_BUSY", "CAD 导入服务队列已满，请稍后重试。", 429)
  if (!response.ok) throw new CadImportError("CAD_IMPORT_REJECTED", `CAD 导入服务拒绝了请求（HTTP ${response.status}）。`, 502)
  const accepted = (await response.json()) as ImportResult
  const settled = await poll(config, accepted.statusUrl ?? `/v1/cad-imports/${accepted.id}`, options.signal)
  if (settled.status !== "succeeded" || !settled.result?.draftUrl) {
    throw new CadImportError("CAD_IMPORT_FAILED", settled.error ?? "CAD 导入未完成，请核对图纸或稍后重试。", 422)
  }
  const draftResponse = await fetch(`${config.baseUrl}${settled.result.draftUrl}`, {
    headers: { authorization: `Bearer ${config.token}` }, signal: options.signal,
  })
  if (!draftResponse.ok) throw new CadImportError("CAD_IMPORT_NO_DRAFT", "无法取回点位草稿，请稍后重试。")
  // 用设计站自己的解析器校验：契约不符要在写库之前就失败。
  return { draft: parsePointMapDraft(await draftResponse.json()), id: settled.id }
}

async function poll(config: CadImportConfig, statusUrl: string, signal?: AbortSignal): Promise<ImportResult> {
  const deadline = Date.now() + CAD_IMPORT_TIMEOUT_MS
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, CAD_IMPORT_POLL_MS))
    if (Date.now() > deadline) throw new CadImportError("CAD_IMPORT_TIMEOUT", "CAD 导入超时，请稍后重试或改用本机导出核对。", 504)
    const response = await fetch(`${config.baseUrl}${statusUrl}`, { headers: { authorization: `Bearer ${config.token}` }, signal })
    if (!response.ok) throw new CadImportError("CAD_IMPORT_STATUS", "无法查询导入进度，请稍后重试。")
    const job = (await response.json()) as ImportResult
    if (job.status === "succeeded" || job.status === "failed") return job
  }
}

/** 把草稿合并进现有方案：保留用户已有编辑，重复导入不重复建点。 */
export function mergeDraftIntoPlan(plan: PointMapPlan, draft: PointMapDraft): { plan: PointMapPlan; added: number; skipped: number } {
  if (!draft.points?.length) throw new CadImportError("CAD_IMPORT_EMPTY", "草稿里没有点位，未做任何修改。", 422)
  return importPointMapDraft(plan, draft)
}
