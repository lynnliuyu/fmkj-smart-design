/**
 * 项目列表页共用的数据规则。
 *
 * 项目、报价、合同三个列表页读的是同一个 `/api/projects`，各自只关心不同的列；
 * 阶段文案、日期格式、搜索匹配和读取失败提示在这里集中一份，避免三处各写一份后走样。
 */

import { formatDate } from "./format-datetime"

/** 项目流水线的阶段取值；顺序即推进顺序。 */
export const PROJECT_STAGE_LABELS: Record<string, string> = {
  new: "新建跟进",
  measure: "现场测量",
  proposal: "方案报价",
  contract: "合同收款",
  install: "安装调试",
  acceptance: "交付验收",
  aftercare: "售后维护",
}

/** 未知阶段不编造，回落到第一个阶段文案。 */
export function projectStageLabel(stage: string | null | undefined) {
  if (stage && PROJECT_STAGE_LABELS[stage]) return PROJECT_STAGE_LABELS[stage]
  return PROJECT_STAGE_LABELS.new
}

/** 三个列表页统一的日期显示（年/月/日）。 */
export function formatProjectDate(value: string | undefined | null) {
  return formatDate(value)
}

/**
 * 列表页搜索：把调用方关心的字段拼成一个字符串再匹配，各页自行决定字段范围。
 */
export function projectMatchesQuery(query: string, fields: Array<string | null | undefined>) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true

  return fields
    .filter((field): field is string => Boolean(field))
    .join(" ")
    .toLowerCase()
    .includes(keyword)
}

/** `/api/projects` 的最小可用行：没有 id / 名称 / 阶段的行不能进入列表。 */
export function isProjectListRow(value: unknown): value is { id: string; name: string; stage: string } {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return Boolean(row.id && row.name && row.stage)
}

export class ProjectListRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ProjectListRequestError"
    this.status = status
  }
}

/**
 * 读取项目列表。三个页面共用同一份请求与最小校验，各自决定怎么显示错误。
 */
export async function fetchProjectListRows<
  T extends { id: string; name: string } = { id: string; name: string; stage?: string },
>(): Promise<T[]> {
  const response = await fetch("/api/projects", { cache: "no-store" })

  if (!response.ok) {
    throw new ProjectListRequestError(response.status, `PROJECT_LIST_${response.status}`)
  }

  const payload = (await response.json()) as { data?: unknown }
  const rows = Array.isArray(payload.data) ? payload.data : []

  // 接口返回的字段比列表最小可用集合多，调用方按自己的行类型取用。
  return rows.filter(isProjectListRow) as unknown as T[]
}

/** 列表页读不到数据时的提示文案，区分登录失效与权限不足。 */
export function projectListErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ProjectListRequestError) {
    if (error.status === 401) return "登录已失效，请重新登录后重试。"
    if (error.status === 403) return "当前账号没有读取项目列表的权限，请核对登录账号。"
  }

  return fallback
}
