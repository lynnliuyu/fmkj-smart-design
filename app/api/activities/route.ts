import { NextResponse } from "next/server"

import { accountContextCan, getCurrentAccountContext, type AccountContext } from "@/lib/account-context"
import {
  type ActivityFeedItem,
  type ActivityLogRow,
  activityLogRowToFeedItem,
  formatDuration,
  formatRelativeTime,
} from "@/lib/activity-feed"
import { getPool } from "@/lib/server-db"
import { projectVisibilityWhere } from "@/lib/project-access"

type ProjectActivityRow = {
  createdAt: Date
  createdBy: string | null
  id: string
  name: string
  risk: "normal" | "watch" | "blocked"
  stage: string
  stageLabel: string | null
  updatedAt: Date
  updatedBy: string | null
}

type QuoteActivityRow = {
  actor: string | null
  id: string
  projectCreatedAt: Date
  projectName: string
  quoteCreatedAt: Date
  quoteNo: string
  total: number
}

export async function GET() {
  const context = await getCurrentAccountContext()

  if (!context) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  if (context.account.status !== "active" || !accountContextCan(context, "project.view")) {
    return NextResponse.json({ error: "PROJECT_VIEW_REQUIRED" }, { status: 403 })
  }

  try {
    const now = new Date()
    const visibility = projectVisibilityWhere(context)
    const persistedActivities = await loadPersistedActivities(now, context)

    if (persistedActivities.length > 0) {
      return NextResponse.json({
        data: persistedActivities,
        source: "postgres",
        total: persistedActivities.length,
      })
    }

    const [projects, quotes] = await Promise.all([
      getPool().query<ProjectActivityRow>(`
        select
          p.id::text,
          p.name,
          p.stage::text,
          p.stage_label as "stageLabel",
          case
            when p.status_tone::text = 'error' then 'blocked'
            when p.status_tone::text = 'warn' then 'watch'
            else 'normal'
          end as risk,
          p.created_at as "createdAt",
          p.updated_at as "updatedAt",
          coalesce(creator.name, creator.email, '系统') as "createdBy",
          coalesce(updater.name, updater.email, '系统') as "updatedBy"
        from projects p
        left join users creator on creator.id = p.created_by
        left join users updater on updater.id = p.updated_by
        where p.deleted_at is null
          and p.status::text <> 'archived'
          and (${visibility.where})
        order by p.updated_at desc, p.created_at desc
        limit 8
      `, visibility.params),
      getPool().query<QuoteActivityRow>(`
        select
          q.id::text,
          q.quote_no as "quoteNo",
          p.name as "projectName",
          q.total_amount::float8 as total,
          q.created_at as "quoteCreatedAt",
          p.created_at as "projectCreatedAt",
          coalesce(updater.name, updater.email, creator.name, creator.email, '系统') as actor
        from quotes q
        join projects p on p.id = q.project_id
        left join users creator on creator.id = q.created_by
        left join users updater on updater.id = q.updated_by
        where q.deleted_at is null
          and p.deleted_at is null
          and (${visibility.where})
        order by q.updated_at desc
        limit 8
      `, visibility.params),
    ])

    const activities = [
      ...projects.rows.flatMap((project) => projectActivities(project, now)),
      ...quotes.rows.map((quote) => quoteActivity(quote, now)),
    ]
      .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
      .slice(0, 12)

    return NextResponse.json({
      data: activities,
      source: "postgres",
      total: activities.length,
    })
  } catch (error) {
    return NextResponse.json({
      data: [],
      error: error instanceof Error ? error.message : "ACTIVITIES_UNAVAILABLE",
      source: "fallback",
      total: 0,
    })
  }
}

async function loadPersistedActivities(now: Date, context: AccountContext) {
  const visibility = projectVisibilityWhere(context)
  const result = await getPool().query<ActivityLogRow>(`
    select
      al.id::text,
      al.action,
      al.actor_name as "actorName",
      al.entity_type as "entityType",
      al.entity_label as "entityLabel",
      al.title,
      al.description,
      al.occurred_at as "occurredAt",
      al.duration_seconds as "durationSeconds",
      al.metadata
    from activity_logs al
    left join quotes aq on al.entity_type = 'quote' and aq.id = al.entity_id and aq.deleted_at is null
    left join projects p on p.id = case when al.entity_type = 'project' then al.entity_id else aq.project_id end
    where (p.id is not null and p.deleted_at is null and (${visibility.where}))
      ${context.account.isSuperAdmin ? "or al.entity_type = 'product'" : ""}
    order by al.occurred_at desc, al.created_at desc
    limit 12
  `, visibility.params)

  return result.rows.map((row) => activityLogRowToFeedItem(row, now))
}

function projectActivities(project: ProjectActivityRow, now: Date) {
  const createdAt = project.createdAt.toISOString()
  const updatedAt = project.updatedAt.toISOString()
  const stageChanged = project.updatedAt.getTime() - project.createdAt.getTime() > 5 * 60 * 1000
  const activities: ActivityFeedItem[] = [
    {
      actor: project.createdBy || "系统",
      description: `${project.createdBy || "系统"} 创建了项目，负责人可以继续补充客户、点位和预算。`,
      happenedAt: createdAt,
      iconKey: "project",
      id: `project-created-${project.id}`,
      kind: "project-created",
      subject: project.name,
      time: formatRelativeTime(project.createdAt, now),
      title: `${project.name} 已创建`,
      tone: "text-sky-700 bg-sky-50 border-sky-200",
    },
  ]

  if (stageChanged) {
    const duration = formatDuration(project.createdAt, project.updatedAt)
    const stageLabel = project.stageLabel || project.stage

    activities.push({
      actor: project.updatedBy || "系统",
      description: `${project.updatedBy || "系统"} 将项目推进到 ${stageLabel}，从创建到当前阶段用了 ${duration}。`,
      duration,
      happenedAt: updatedAt,
      iconKey: project.risk === "blocked" ? "alert" : "map",
      id: `project-advanced-${project.id}`,
      kind: project.risk === "blocked" ? "risk" : "project-advanced",
      subject: project.name,
      time: formatRelativeTime(project.updatedAt, now),
      title: project.risk === "blocked" ? `${project.name} 有阻塞` : `${project.name} 阶段已推进`,
      tone:
        project.risk === "blocked"
          ? "text-red-700 bg-red-50 border-red-200"
          : "text-emerald-700 bg-emerald-50 border-emerald-200",
    })
  }

  return activities
}

function quoteActivity(quote: QuoteActivityRow, now: Date): ActivityFeedItem {
  const duration = formatDuration(quote.projectCreatedAt, quote.quoteCreatedAt)

  return {
    actor: quote.actor || "系统",
    description: `${quote.actor || "系统"} 生成 ${quote.quoteNo}，从项目创建到报价用了 ${duration}，报价金额 ${money(quote.total)}。`,
    duration,
    happenedAt: quote.quoteCreatedAt.toISOString(),
    iconKey: "quote",
    id: `quote-generated-${quote.id}`,
    kind: "quote-generated",
    subject: quote.projectName,
    time: formatRelativeTime(quote.quoteCreatedAt, now),
    title: `${quote.projectName} 报价已生成`,
    tone: "text-amber-700 bg-amber-50 border-amber-200",
  }
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value)
}
