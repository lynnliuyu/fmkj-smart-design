export type PointMapMarker = { id: string; x: number; y: number; label: string; display?: { x: number; y: number; labelX: number; labelY: number } }
export type PointMapMarkerBounds = { left: number; top: number; width: number; height: number }
export type PointMapMarkerLayoutInput = {
  markers: readonly PointMapMarker[]
  bounds: PointMapMarkerBounds
  radius: number
  labelHeight: number
  labelWidth: (label: string) => number
}
export type PointMapMarkerPlacement = {
  id: string
  x: number
  y: number
  anchorX: number
  anchorY: number
  labelX: number
  labelY: number
  labelWidth: number
  labelHeight: number
  displaced: boolean
}

export class PointMapMarkerLayoutError extends Error {}

type Circle = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }

/**
 * Arrange display circles without changing their installation anchors. Later
 * anchors are reserved so an early displaced circle cannot steal a clear spot.
 * A bounded deterministic search reports crowded layouts instead of hiding points.
 */
export function layoutPointMapMarkers(input: PointMapMarkerLayoutInput): PointMapMarkerPlacement[] {
  const { markers, bounds, radius, labelHeight } = input
  if (![bounds.left, bounds.top, bounds.width, bounds.height, radius, labelHeight].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || radius <= 0 || labelHeight <= 0) fail("点位排布的范围、半径和标签高度必须是有效正数")
  const ids = new Set<string>()
  const measured = markers.map((marker) => {
    if (!marker.id || ids.has(marker.id)) fail("点位排布的 ID 缺失或重复")
    ids.add(marker.id)
    if (![marker.x, marker.y].every(Number.isFinite)) fail(`点位 ${marker.label || marker.id} 的排布坐标无效`)
    const width = input.labelWidth(marker.label)
    if (!Number.isFinite(width) || width < 0 || width > bounds.width || labelHeight > bounds.height) fail(`点位 ${marker.label || marker.id} 的标签超出排布范围，请增加画布留白或缩短标签`)
    return { ...marker, width }
  })
  const gap = Math.max(3, radius * .12)
  const placements: PointMapMarkerPlacement[] = []
  const circles: Circle[] = []
  const labels: Rect[] = []
  // Explicit customer adjustments are fixed first. Automatic markers avoid
  // them; an invalid manual layout is reported rather than silently changed.
  for (const marker of measured.filter((marker) => marker.display)) {
    const display = marker.display!
    const circle = { x: display.x, y: display.y }
    const label = { x: display.labelX, y: display.labelY, width: marker.width, height: labelHeight }
    if (![display.x, display.y, display.labelX, display.labelY].every(Number.isFinite) || !circleInside(circle, radius, bounds) || !rectInside(label, bounds) || circles.some((other) => Math.hypot(circle.x - other.x, circle.y - other.y) < radius * 2 + gap) || labels.some((other) => circleOverlapsRect(circle, radius + gap, other)) || [circle, ...circles].some((other) => circleOverlapsRect(other, radius + gap, label)) || labels.some((other) => rectsOverlap(label, other, gap))) fail(`点位 ${marker.label || marker.id} 的手工展示位置重叠或超出画布，请移动或复位商品圆图与文字。`)
    placements.push({ id: marker.id, ...circle, anchorX: marker.x, anchorY: marker.y, labelX: label.x, labelY: label.y, labelWidth: marker.width, labelHeight, displaced: Math.hypot(circle.x - marker.x, circle.y - marker.y) > 1e-6 })
    circles.push(circle)
    labels.push(label)
  }
  for (const [index, marker] of measured.entries()) {
    if (marker.display) continue
    const reserved = measured.slice(index + 1).filter((point) => !point.display && circleInside(point, radius, bounds))
    let found: PointMapMarkerPlacement | undefined
    for (const circle of candidates(marker, bounds, radius)) {
      if (!circleInside(circle, radius, bounds)) continue
      if ([...circles, ...reserved].some((other) => Math.hypot(circle.x - other.x, circle.y - other.y) < 2 * radius + gap)) continue
      if (labels.some((label) => circleOverlapsRect(circle, radius + gap, label))) continue
      const label = labelCandidates(circle, marker.width, labelHeight, radius, gap, bounds).find((label) =>
        rectInside(label, bounds) &&
        ![circle, ...circles, ...reserved].some((other) => circleOverlapsRect(other, radius + gap, label)) &&
        !labels.some((other) => rectsOverlap(label, other, gap)),
      )
      if (!label) continue
      found = {
        id: marker.id, x: circle.x, y: circle.y, anchorX: marker.x, anchorY: marker.y,
        labelX: label.x, labelY: label.y, labelWidth: marker.width, labelHeight,
        displaced: Math.hypot(circle.x - marker.x, circle.y - marker.y) > 1e-6,
      }
      circles.push(circle)
      labels.push(label)
      break
    }
    if (!found) fail(`点位 ${marker.label || marker.id} 附近空间不足，无法在四个直径内完成无重叠排布；请增加画布留白或适当减小商品圆图。`)
    placements.push(found)
  }
  const byId = new Map(placements.map((placement) => [placement.id, placement]))
  return markers.map((marker) => byId.get(marker.id)!)
}

function* candidates(anchor: Circle, bounds: PointMapMarkerBounds, radius: number): Generator<Circle> {
  yield { x: anchor.x, y: anchor.y }
  const clamped = {
    x: Math.max(bounds.left + radius, Math.min(anchor.x, bounds.left + bounds.width - radius)),
    y: Math.max(bounds.top + radius, Math.min(anchor.y, bounds.top + bounds.height - radius)),
  }
  if (Math.hypot(clamped.x - anchor.x, clamped.y - anchor.y) <= radius * 8) yield clamped
  for (let step = 1; step <= 16; step++) {
    const distance = radius * step / 2
    for (let direction = 0; direction < 32; direction++) {
      const angle = -Math.PI / 2 + direction * Math.PI / 16
      yield { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance }
    }
  }
}

function labelCandidates(circle: Circle, width: number, height: number, radius: number, gap: number, bounds: PointMapMarkerBounds): Rect[] {
  const clampX = (x: number) => Math.max(bounds.left, Math.min(x, bounds.left + bounds.width - width))
  const below = circle.y + radius + gap
  const above = circle.y - radius - gap - height
  const horizontal = [circle.x - width / 2, circle.x, circle.x - width].map(clampX)
  return [
    ...horizontal.map((x) => ({ x, y: below, width, height })),
    { x: circle.x + radius + gap, y: circle.y - height / 2, width, height },
    ...horizontal.map((x) => ({ x, y: above, width, height })),
    { x: circle.x - radius - gap - width, y: circle.y - height / 2, width, height },
  ]
}

function circleInside(circle: Circle, radius: number, bounds: PointMapMarkerBounds) {
  return circle.x - radius >= bounds.left && circle.y - radius >= bounds.top && circle.x + radius <= bounds.left + bounds.width && circle.y + radius <= bounds.top + bounds.height
}

function rectInside(rect: Rect, bounds: PointMapMarkerBounds) {
  return rect.x >= bounds.left && rect.y >= bounds.top && rect.x + rect.width <= bounds.left + bounds.width && rect.y + rect.height <= bounds.top + bounds.height
}

function circleOverlapsRect(circle: Circle, radius: number, rect: Rect) {
  const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width))
  const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height))
  return Math.hypot(circle.x - x, circle.y - y) < radius - 1e-7
}

function rectsOverlap(a: Rect, b: Rect, gap: number) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
}

function fail(message: string): never { throw new PointMapMarkerLayoutError(message) }
