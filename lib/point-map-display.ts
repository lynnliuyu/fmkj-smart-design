import { applyPointMapPlanPatch, normalizePointMapDisplay, type PointMapDisplayPlacement, type PointMapPlan } from "./point-map-plan"
import type { PointMapRenderGeometry } from "./point-map-render"

/** Convert the exact rendered placement to stable offsets from its installation anchor. */
export function pointMapDisplayFromGeometry(geometry: PointMapRenderGeometry, pointId: string): PointMapDisplayPlacement {
  const point = geometry.markers.find((marker) => marker.pointId === pointId)
  if (!point || geometry.image.width <= 0 || geometry.image.height <= 0) throw new Error("请先生成当前楼层的最新点位图。")
  return {
    markerOffset: { x: (point.marker.x - point.anchor.x) / geometry.image.width * 100, y: (point.marker.y - point.anchor.y) / geometry.image.height * 100 },
    labelOffset: { x: (point.labelRect.x - point.labelBase.x) / geometry.image.width * 100, y: (point.labelRect.y - point.labelBase.y) / geometry.image.height * 100 },
  }
}

export function movePointMapDisplay(plan: PointMapPlan, geometry: PointMapRenderGeometry, pointId: string, part: "marker" | "label", delta: { x: number; y: number }, now?: () => string): PointMapPlan {
  const point = plan.points.find((point) => point.id === pointId)
  if (!point) throw new Error("未找到需要调整的点位。")
  const display = structuredClone(point.display ?? pointMapDisplayFromGeometry(geometry, pointId))
  const key = part === "marker" ? "markerOffset" : "labelOffset"
  display[key].x += delta.x / geometry.image.width * 100
  display[key].y += delta.y / geometry.image.height * 100
  const normalized = normalizePointMapDisplay(display)
  return applyPointMapPlanPatch(plan, { points: plan.points.map((point) => point.id === pointId ? { ...point, display: normalized } : point) }, { now })
}

export function resetPointMapDisplay(plan: PointMapPlan, pointId: string, now?: () => string): PointMapPlan {
  return applyPointMapPlanPatch(plan, { points: plan.points.map((point) => {
    if (point.id !== pointId) return point
    const next = { ...point }
    delete next.display
    return next
  }) }, { now })
}
