/**
 * 日期时间的统一显示。
 *
 * 为什么不能直接用 `new Date(x).toLocaleString("zh-CN")`：
 * 服务端渲染时用的是服务器的时区和语言环境，浏览器里用的是用户自己的。
 * 服务器按 UTC 跑（Vercel / Docker 默认就是），用户在东八区，同一个时间戳
 * 两边算出来的日期可能差一天、时间差 8 小时，React 就会报 hydration 不一致，
 * 严重时页面会先闪一下再被修正。实测 2026-10-22 在 /admin/customers、
 * /admin/audit-logs、/admin/products 三个页面复现。
 *
 * 这里显式钉死时区与格式，保证同一个时间戳在任何机器上都渲染成同一个字符串。
 * 全站所有日期显示都走这两个函数，不要再写裸的 toLocale*。
 */

const TIME_ZONE = "Asia/Shanghai"

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** 空值或非法时间回落到 `fallback`，不编造日期。 */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = "-"
): string {
  const date = toDate(value)
  return date ? dateFormatter.format(date) : fallback
}

/** 年/月/日 时:分，24 小时制。 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = "-"
): string {
  const date = toDate(value)
  return date ? dateTimeFormatter.format(date) : fallback
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null

  const date = value instanceof Date ? value : new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}
