"use client"

import * as React from "react"
import { UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PointMapPlan } from "@/lib/point-map-plan"
import { applyPointMapPresentationBundle, measurePresentationCalibration } from "@/lib/point-map-presentation"

export function PointMapPresentationPanel({ plan, disabled, saved, onApply }: {
  plan: PointMapPlan
  disabled: boolean
  saved: boolean
  onApply: (next: PointMapPlan, expected: PointMapPlan) => boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  const backgrounds = (plan.floors ?? []).filter((floor) => floor.presentation)

  async function importBackgrounds(file: File | null) {
    if (!file || disabled || loading) return
    setLoading(true)
    setMessage("")
    setError("")
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("风格底图文件过大，请分层导入。")
      const next = await applyPointMapPresentationBundle(plan, JSON.parse(await file.text()))
      if (!onApply(next, plan)) throw new Error("图纸在导入期间已发生变化，请重新导入。")
      setMessage("风格底图已绑定到当前草稿，请点击保存到数据库。导出时会叠加最新商品点位。")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "风格底图导入失败，请检查文件。")
    } finally {
      setLoading(false)
    }
  }

  return <details className="border-t pt-3">
    <summary className="cursor-pointer text-sm font-medium">客户展示底图 · {backgrounds.length ? `已绑定 ${backgrounds.length} 层风格净底` : "使用工程净底"}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">在工程图上调整点位。导出 PNG 和 PDF 时，使用各楼层已校准的风格净底并叠加商品圆图；移动点位或更换商品可复用底图。</p>
      <Button size="sm" variant="outline" disabled={disabled || loading} onClick={() => inputRef.current?.click()}><UploadCloud className="size-4" />{loading ? "正在校验底图…" : "导入已校准风格底图"}</Button>
      <input ref={inputRef} type="file" aria-label="导入已校准风格底图" accept="application/json,.json" className="hidden" disabled={disabled || loading} onChange={(event) => { void importBackgrounds(event.target.files?.[0] ?? null); event.currentTarget.value = "" }} />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{saved ? "风格底图已保存到数据库，导出时会叠加最新商品点位。" : message}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">{backgrounds.map((floor) => {
        const background = floor.presentation!
        const calibration = measurePresentationCalibration(background)
        return <figure key={floor.id} className="rounded-lg bg-muted/60 p-3"><img src={background.imageDataUrl} alt={`${floor.name} 风格净底（不含点位）`} className="h-44 w-full object-contain" /><figcaption className="mt-2 text-sm font-medium">{floor.name} · {background.name}</figcaption><p className="mt-1 text-xs text-muted-foreground">{calibration.anchorCount} 处校准参考 · 展示效果图</p></figure>
      })}</div>
    </div>
  </details>
}
