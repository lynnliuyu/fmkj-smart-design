import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  FolderKanban,
  Hammer,
  MapPinned,
  type LucideIcon,
} from "lucide-react"

export type ActivityKind =
  | "project-created"
  | "project-advanced"
  | "quote-generated"
  | "work-order-created"
  | "work-order-completed"
  | "risk"

export type ActivityIconKey = "alert" | "check" | "clock" | "hammer" | "map" | "project" | "quote"

export type ActivityFeedItem = {
  actor: string
  description: string
  duration?: string
  happenedAt: string
  iconKey: ActivityIconKey
  id: string
  kind: ActivityKind
  subject: string
  time: string
  title: string
  tone: string
}

export type ActivityNotificationItem = {
  actor?: string
  description: string
  duration?: string
  happenedAt?: string
  icon: LucideIcon
  subject?: string
  time: string
  title: string
  tone: string
}

export type ActivityLogAction =
  | "project.created"
  | "project.stage_advanced"
  | "project.risk_toggled"
  | "quote.created"
  | "quote.updated"
  | "work_order.created"
  | "work_order.completed"

export type ActivityLogRow = {
  action: ActivityLogAction | string
  actorName: string | null
  description: string
  durationSeconds: number | null
  entityLabel: string
  entityType: string
  id: string
  metadata: Record<string, unknown> | null
  occurredAt: Date | string
  title: string
}

export const activityIconMap: Record<ActivityIconKey, LucideIcon> = {
  alert: AlertTriangle,
  check: CheckCircle2,
  clock: Clock3,
  hammer: Hammer,
  map: MapPinned,
  project: FolderKanban,
  quote: FileSpreadsheet,
}

export function toActivityNotification(item: ActivityFeedItem): ActivityNotificationItem {
  return {
    actor: item.actor,
    description: item.description,
    duration: item.duration,
    happenedAt: item.happenedAt,
    icon: activityIconMap[item.iconKey],
    subject: item.subject,
    time: item.time,
    title: item.title,
    tone: item.tone,
  }
}

export function activityLogRowToFeedItem(row: ActivityLogRow, now = new Date()): ActivityFeedItem {
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
  const metadata = row.metadata ?? {}
  const risk = String(metadata.toRisk ?? "")
  const mapped = activityActionPresentation(row.action, risk)
  const duration = row.durationSeconds ? formatDurationFromSeconds(row.durationSeconds) : undefined

  return {
    actor: cleanText(row.actorName) || "系统",
    description: cleanText(row.description) || defaultDescription(row.action, row.entityLabel),
    duration,
    happenedAt: occurredAt.toISOString(),
    iconKey: mapped.iconKey,
    id: row.id,
    kind: mapped.kind,
    subject: cleanText(row.entityLabel) || "业务对象",
    time: formatRelativeTime(occurredAt, now),
    title: cleanText(row.title) || defaultTitle(row.action, row.entityLabel),
    tone: mapped.tone,
  }
}

export function activityActionPresentation(action: string, risk = "") {
  if (action === "project.created") {
    return {
      iconKey: "project" as const,
      kind: "project-created" as const,
      tone: "text-sky-700 bg-sky-50 border-sky-200",
    }
  }

  if (action === "project.stage_advanced") {
    return {
      iconKey: "map" as const,
      kind: "project-advanced" as const,
      tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    }
  }

  if (action === "project.risk_toggled") {
    return {
      iconKey: "alert" as const,
      kind: "risk" as const,
      tone: risk === "blocked" ? "text-red-700 bg-red-50 border-red-200" : "text-amber-700 bg-amber-50 border-amber-200",
    }
  }

  if (action === "quote.created" || action === "quote.updated") {
    return {
      iconKey: "quote" as const,
      kind: "quote-generated" as const,
      tone: "text-amber-700 bg-amber-50 border-amber-200",
    }
  }

  if (action === "work_order.completed") {
    return {
      iconKey: "check" as const,
      kind: "work-order-completed" as const,
      tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    }
  }

  return {
    iconKey: "hammer" as const,
    kind: "work-order-created" as const,
    tone: "text-violet-700 bg-violet-50 border-violet-200",
  }
}

export function formatRelativeTime(value: string | Date, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const diffMs = Math.max(0, now.getTime() - date.getTime())
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return "刚刚"
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)} 天前`

  return date.toLocaleDateString("zh-CN", {
    day: "2-digit",
    month: "2-digit",
  })
}

export function formatDuration(start: string | Date, end: string | Date) {
  const startDate = start instanceof Date ? start : new Date(start)
  const endDate = end instanceof Date ? end : new Date(end)
  const diffMs = Math.max(0, endDate.getTime() - startDate.getTime())
  return formatDurationFromSeconds(Math.round(diffMs / 1000))
}

export function formatDurationFromSeconds(seconds: number) {
  const hour = 60 * 60
  const day = 24 * hour

  if (seconds < hour) return "1 小时内"
  if (seconds < day) return `${Math.max(1, Math.round(seconds / hour))} 小时`
  return `${Math.max(1, Math.round(seconds / day))} 天`
}

function defaultTitle(action: string, entityLabel: string) {
  const label = cleanText(entityLabel) || "业务对象"
  if (action === "project.created") return `${label} 已创建`
  if (action === "project.stage_advanced") return `${label} 阶段已推进`
  if (action === "project.risk_toggled") return `${label} 风险状态已更新`
  if (action === "quote.created" || action === "quote.updated") return `${label} 报价已更新`
  if (action === "work_order.completed") return `${label} 工单已完成`
  return `${label} 工单已创建`
}

function defaultDescription(action: string, entityLabel: string) {
  const label = cleanText(entityLabel) || "该项目"
  if (action === "project.created") return `${label} 已创建，负责人可以继续补充客户、点位和预算。`
  if (action === "project.stage_advanced") return `${label} 已推进到新的项目阶段。`
  if (action === "project.risk_toggled") return `${label} 的风险状态发生变化，请及时确认。`
  if (action === "quote.created" || action === "quote.updated") return `${label} 的报价已更新。`
  if (action === "work_order.completed") return `${label} 的工单已完成，等待交付资料和验收确认。`
  return `${label} 已创建工单，等待安排处理。`
}

function cleanText(value: string | null | undefined) {
  const text = String(value ?? "").trim()
  return looksCorrupted(text) ? "" : text
}

function looksCorrupted(text: string) {
  return /[�]/.test(text) || /[绯荤鍒涘宸撳]/.test(text)
}
