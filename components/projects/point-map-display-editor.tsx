"use client"

import * as React from "react"
import { Move, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PointMapPlan } from "@/lib/point-map-plan"
import type { PointMapPrintFloor } from "@/lib/point-map-print"
import { movePointMapDisplay, resetPointMapDisplay } from "@/lib/point-map-display"

type Drag = { pointId: string; part: "marker" | "label"; startX: number; startY: number; x: number; y: number; pointerId: number }
export type PointMapDisplayEditorProps = {
  plan: PointMapPlan
  floor: PointMapPrintFloor
  disabled?: boolean
  onChange: (nextPlan: PointMapPlan) => void
  selectedPointId?: string | null
  onPointSelect?: (pointId: string) => void
  highlightPointIds?: readonly string[]
}

/** Hit targets come from the very canvas shown here, including collision displacement. */
export function PointMapDisplayEditor({ plan, floor, disabled, onChange, selectedPointId, onPointSelect, highlightPointIds = [] }: PointMapDisplayEditorProps) {
  const host = React.useRef<HTMLDivElement>(null)
  const [localSelection, setLocalSelection] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<Drag | null>(null)
  const [error, setError] = React.useState("")
  const selected = selectedPointId === undefined ? localSelection : selectedPointId
  const geometry = floor.markerGeometry
  const point = geometry?.markers.some((marker) => marker.pointId === selected) ? plan.points.find((point) => point.id === selected) : undefined
  const highlights = new Set(highlightPointIds)

  function select(pointId: string) { setLocalSelection(pointId); onPointSelect?.(pointId) }
  function begin(event: React.PointerEvent<HTMLButtonElement>, pointId: string, part: "marker" | "label") {
    select(pointId)
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setError("")
    setDrag({ pointId, part, startX: event.clientX, startY: event.clientY, x: 0, y: 0, pointerId: event.pointerId })
  }
  function movement(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId || !host.current) return
    const rect = host.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setDrag({ ...drag, x: (event.clientX - drag.startX) / rect.width * 100, y: (event.clientY - drag.startY) / rect.height * 100 })
  }
  function apply(pointId: string, part: "marker" | "label", delta: { x: number; y: number }) {
    if (!geometry || disabled) return
    try { onChange(movePointMapDisplay(plan, geometry, pointId, part, delta)); setError("") }
    catch (reason) { setError(reason instanceof Error ? reason.message : "展示位置无法更新，请重试。") }
  }
  function finish(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (host.current) {
      const rect = host.current.getBoundingClientRect()
      const delta = { x: (event.clientX - drag.startX) / rect.width * 100, y: (event.clientY - drag.startY) / rect.height * 100 }
      if (Math.hypot(delta.x, delta.y) > .03) apply(drag.pointId, drag.part, delta)
    }
    setDrag(null)
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, pointId: string, part: "marker" | "label") {
    if (disabled || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 1 : .2
    apply(pointId, part, { x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0 })
  }

  return <section className="space-y-3" aria-label={`${floor.name}展示排版`}>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <div className="flex items-center gap-2 font-medium"><Move className="size-4" />商品圆图排版</div>
      <p className="flex-1 text-sm text-muted-foreground">{disabled ? "选择点位查看关联商品与场景。" : "拖动圆图或文字，松开后更新预览。方向键微调，Shift 加快。"}</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled || !point?.display} onClick={() => { if (selected) { onChange(resetPointMapDisplay(plan, selected)); setError("") } }}><RotateCcw className="size-4" />复位所选排版</Button>
    </div>
    {geometry?.markers.length ? <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={`display-point-${floor.id}`} className="text-muted-foreground">当前点位</label>
      <select id={`display-point-${floor.id}`} value={selected && geometry.markers.some((marker) => marker.pointId === selected) ? selected : ""} onChange={(event) => { if (event.target.value) select(event.target.value) }} className="min-h-10 max-w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
        <option value="">点击图上的圆图或文字</option>
        {geometry.markers.map((marker) => { const item = plan.points.find((point) => point.id === marker.pointId); return <option key={marker.pointId} value={marker.pointId}>{item?.code || marker.pointId} · {marker.label} · {item?.room}</option> })}
      </select>
      {point ? <span className="text-muted-foreground">{point.room} · {point.display ? "手工排版" : "自动排版"}</span> : null}
    </div> : null}
    <div ref={host} className="relative select-none bg-white" style={geometry ? { aspectRatio: `${geometry.width} / ${geometry.height}` } : undefined}>
      <img src={floor.src} alt={`${floor.name}商品点位展示图`} draggable={false} className="block h-auto w-full" />
      {geometry?.markers.flatMap((marker) => (["marker", "label"] as const).map((part) => {
        const active = selected === marker.pointId
        const highlighted = highlights.has(marker.pointId)
        const moving = drag?.pointId === marker.pointId && (drag.part === "marker" || drag.part === part)
        const delta = moving ? { x: drag.x, y: drag.y } : { x: 0, y: 0 }
        const rect = part === "marker" ? { x: marker.marker.x - marker.marker.radiusX, y: marker.marker.y - marker.marker.radiusY, width: marker.marker.radiusX * 2, height: marker.marker.radiusY * 2 } : marker.labelRect
        return <button key={`${marker.pointId}-${part}`} type="button" aria-label={`${plan.points.find((point) => point.id === marker.pointId)?.code || marker.pointId} ${marker.label}${part === "marker" ? "圆图" : "文字"}${disabled ? "，查看关联" : "，拖动调整展示位置"}`} aria-pressed={active}
          onFocus={() => select(marker.pointId)} onClick={() => select(marker.pointId)} onPointerDown={(event) => begin(event, marker.pointId, part)} onPointerMove={movement} onPointerUp={finish} onPointerCancel={() => setDrag(null)} onKeyDown={(event) => keyboard(event, marker.pointId, part)}
          className={`absolute border-2 bg-transparent outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 ${part === "marker" ? "rounded-full" : "rounded-sm"} ${active ? "border-primary" : highlighted ? "border-amber-600" : "border-transparent hover:border-primary/60"} ${disabled ? "cursor-pointer" : "touch-none cursor-move"}`}
          style={{ left: `${rect.x + delta.x}%`, top: `${rect.y + delta.y}%`, width: `${rect.width}%`, height: `${rect.height}%`, ...(moving ? { background: "rgba(255,255,255,.55)" } : {}) }} />
      }))}
    </div>
    {!geometry ? <p role="status" className="text-sm text-muted-foreground">生成最新版后，即可选择圆图与文字调整展示排版。</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <p className="text-xs leading-5 text-muted-foreground">展示排版独立保存，安装点位、设备数量和报价保持原数据。复位后恢复自动避让。</p>
  </section>
}
