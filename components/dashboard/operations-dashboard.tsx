"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ClipboardCheck,
  FileSpreadsheet,
  FolderKanban,
  Plus,
} from "lucide-react"

import { ActivityTimeline } from "@/components/animate-ui/activity-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ActivityFeedItem } from "@/lib/activity-feed"
import { cn } from "@/lib/utils"

type DashboardProject = {
  id: string
  name: string
  quoteAmount?: number | null
  risk?: "normal" | "watch" | "blocked" | null
  riskLevel?: "normal" | "watch" | "blocked" | null
  stage: string
}

export function OperationsDashboard() {
  const [projects, setProjects] = React.useState<DashboardProject[]>([])
  const [activities, setActivities] = React.useState<ActivityFeedItem[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true

    async function loadDashboard() {
      setLoading(true)
      try {
        const [projectsResponse, activitiesResponse] = await Promise.all([
          fetch("/api/projects", { cache: "no-store" }),
          fetch("/api/activities", { cache: "no-store" }),
        ])
        const projectsPayload = (await projectsResponse.json()) as { data?: DashboardProject[] }
        const activitiesPayload = (await activitiesResponse.json()) as { data?: ActivityFeedItem[] }

        if (!active) return
        setProjects(projectsPayload.data ?? [])
        setActivities(activitiesPayload.data ?? [])
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadDashboard()

    return () => {
      active = false
    }
  }, [])

  const summary = summarizeProjects(projects)
  // 概览只讲项目推进；商品展示图更新属于目录维护，收进平台日志。
  const projectActivities = activities.filter((item) => item.kind !== "catalog")
  const catalogActivityCount = activities.length - projectActivities.length

  return (
    <section className="flex flex-col gap-5">
      <DashboardHeader />

      <div className="grid gap-2 md:grid-cols-4">
        <MetricCard href="/projects" icon={FolderKanban} label="项目总数" value={summary.total} />
        <MetricCard href="/projects" icon={AlertTriangle} label="风险/关注" tone={summary.risk > 0 ? "warning" : "default"} value={summary.risk} />
        <MetricCard href="/quotes" icon={FileSpreadsheet} label="待报价" value={summary.unquoted} />
        <MetricCard href="/projects" icon={ClipboardCheck} label="安装阶段" value={summary.installing} />
      </div>

      <Card className="rounded-lg">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">最近动态</CardTitle>
            <CardDescription>项目、报价和工单的最新操作记录。</CardDescription>
          </div>
          <Button asChild size="sm">
            <Link href="/projects">
              <Plus className="size-4" />
              新建项目
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="max-h-[280px] overflow-y-auto pr-1">
            {projectActivities.length ? (
              <ActivityTimeline items={projectActivities.slice(0, 5)} />
            ) : (
              <EmptyState
                text={
                  loading
                    ? "正在加载动态"
                    : "最近没有项目动态。项目推进、报价和工单变化都会显示在这里，可以先从项目列表开始。"
                }
              />
            )}
          </div>
          {catalogActivityCount > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              另有 {catalogActivityCount} 条产品目录维护记录（展示图更新等），见平台管理的操作日志。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function DashboardHeader() {
  return (
    <div>
      <Badge variant="outline" className="mb-3">
        项目
      </Badge>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">今天要推进什么</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        聚焦当前账号可见项目、待报价、安装交付和最近动态，先处理需要推进的事情。
      </p>
    </div>
  )
}

function MetricCard({
  href,
  icon: Icon,
  label,
  tone = "default",
  value,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone?: "default" | "warning"
  value: number
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100/70"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString("zh-CN")}</div>
    </Link>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>
}

function summarizeProjects(projects: DashboardProject[]) {
  let risk = 0
  let unquoted = 0
  let installing = 0

  for (const project of projects) {
    if (normalizeRisk(project) !== "normal") risk += 1
    if (!project.quoteAmount) unquoted += 1
    if (project.stage === "install") installing += 1
  }

  return {
    installing,
    risk,
    total: projects.length,
    unquoted,
  }
}

function normalizeRisk(project: DashboardProject) {
  return project.riskLevel ?? project.risk ?? "normal"
}
