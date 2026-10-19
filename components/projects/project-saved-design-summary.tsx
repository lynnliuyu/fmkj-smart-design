"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"

import { SummaryTile } from "@/components/business/summary-tile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { normalizeDesignPlan } from "@/lib/point-map-design"
import { fetchProjectPointMap, PointMapRequestError, type PointMapResponse } from "./point-map-client"

export function ProjectSavedDesignSummary({ projectId }: { projectId: string }) {
  const [saved, setSaved] = React.useState<PointMapResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError("")
      setSaved(null)
      try {
        const result = await fetchProjectPointMap(projectId)
        const nextSaved = { ...result, data: result.data ? normalizeDesignPlan(result.data) : null }
        if (active) setSaved(nextSaved)
      } catch (cause) {
        if (!active) return
        setError(
          cause instanceof PointMapRequestError
            ? cause.status === 401
              ? "登录已失效，请重新登录后重试。"
              : cause.status === 403
                ? "当前账号没有查看此项目点位图的权限。"
                : `读取失败（HTTP ${cause.status}）：${cause.message}`
            : cause instanceof Error
              ? `读取失败：${cause.message}`
              : "读取已保存点位草稿失败，请重试。",
        )
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [projectId, attempt])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-4 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" />
        正在读取已保存的点位草稿…
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 p-4" role="alert">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw className="size-4" />
          重新读取草稿
        </Button>
      </div>
    )
  }

  if (!saved?.data) {
    return (
      <div className="space-y-1 rounded-lg border border-dashed p-4 text-sm">
        <p className="font-medium">尚未导入点位草稿</p>
        <p className="text-muted-foreground">打开点位规划，上传底图或导入助手草稿；保存到数据库后会显示在这里。</p>
      </div>
    )
  }

  const plan = saved.data
  const floors = plan.floors ?? []
  const placedCount = plan.points.filter((point) => point.placed).length
  const pendingCount = plan.points.length - placedCount
  const pendingProducts = plan.points.filter((point) => !point.productId).length
  const pendingScenes = (plan.scenes ?? []).filter((scene) => scene.status !== "confirmed").length
  const pointMapHref = `/point-map?projectId=${encodeURIComponent(projectId)}`

  return (
    <div className="space-y-4" aria-label="已保存点位草稿">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">已保存点位草稿</h3>
        <Badge variant="secondary">数据库草稿 r{saved.revision}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="底图 / 图纸" value={`${floors.filter((floor) => floor.floorplanDataUrl).length} / ${floors.length}`} />
        <SummaryTile label="点位" value={`${plan.points.length} 个`} detail={`${placedCount} 已定位 · ${pendingCount} 待定位`} />
        <SummaryTile label="商品待选型" value={`${pendingProducts} 个点位`} />
        <SummaryTile label="场景待确认" value={`${pendingScenes} / ${(plan.scenes ?? []).length} 个`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {floors.map((floor) => {
          const points = plan.points.filter((point) => point.floorId === floor.id)
          return (
            <Link key={floor.id} href={pointMapHref} className="overflow-hidden rounded-lg border transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <div className="flex aspect-[4/3] items-center justify-center border-b bg-white p-2">
                {floor.floorplanDataUrl ? (
                  // Engineering data URLs are local project assets; preserve their exact source.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={floor.floorplanDataUrl} alt={`${floor.name}工程底图`} className="h-full w-full object-contain" />
                ) : <span className="text-sm text-muted-foreground">底图待上传</span>}
              </div>
              <div className="space-y-1 p-3">
                <p className="text-sm font-medium">{floor.name}</p>
                <p className="text-xs text-muted-foreground">{points.length} 个点位 · {points.filter((point) => !point.placed).length} 个待定位</p>
              </div>
            </Link>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">以上为数据库中已保存的工程底图和草稿统计。类别、位置、商品与场景仍需逐项核对。</p>
    </div>
  )
}
