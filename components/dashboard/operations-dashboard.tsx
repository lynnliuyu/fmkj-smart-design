"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { ActivityTimeline } from "@/components/animate-ui/activity-timeline"
import { StatStrip } from "@/components/business/summary-tile"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ActivityFeedItem } from "@/lib/activity-feed"

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

  // 值为 0 的统计不渲染：沉默优于噪音。
  const summaryItems = [
    { label: "项目总数", value: summary.total, href: "/projects" },
    { label: "待报价", value: summary.unquoted, href: "/quotes" },
    { label: "风险/关注", value: summary.risk, tone: "warn" as const, href: "/projects" },
    { label: "安装阶段", value: summary.installing, href: "/projects" },
  ].filter((item) => item.value > 0)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">今天要推进什么</h1>
        <Button asChild>
          <Link href="/projects">
            <Plus className="size-4" />
            新建项目
          </Link>
        </Button>
      </div>

      {summaryItems.length ? <StatStrip items={summaryItems} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>最近动态</CardTitle>
          <CardDescription>项目、报价和工单的最新变化。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[280px] overflow-y-auto pr-1">
            {projectActivities.length ? (
              <ActivityTimeline items={projectActivities.slice(0, 5)} />
            ) : (
              <EmptyState
                text={loading ? "正在加载动态" : "还没有动态，去项目列表推进下一步。"}
              />
            )}
          </div>
          {catalogActivityCount > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              另有 {catalogActivityCount} 条产品目录维护记录，见平台管理日志。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">{text}</div>
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
