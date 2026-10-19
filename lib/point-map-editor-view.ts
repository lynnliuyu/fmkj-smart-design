import { POINT_MAP_EDITOR_HIT_SIZE } from "./point-map-image-size.mjs"

export const POINT_MAP_MAX_EDITOR_ZOOM = 16
export type EditorAnchor = { id: string; x: number; y: number }
export type EditorMarkerGroup = { id: string; pointIds: string[]; x: number; y: number }
type Geometry = { width: number; height: number; fitScale: number }

/** Screen overlap is a temporary view grouping, never an installation-point merge. */
export function groupPointMapEditorMarkers(points: readonly EditorAnchor[], geometry: Geometry, zoom: number, pinnedId?: string | null): EditorMarkerGroup[] {
  const width = geometry.width * geometry.fitScale * zoom
  const height = geometry.height * geometry.fitScale * zoom
  if (![width, height].every(Number.isFinite) || Math.min(width, height) <= 0) throw new Error("画布比例无效")
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id))
  const parent = sorted.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const cells = new Map<string, number[]>()
  const gap = POINT_MAP_EDITOR_HIT_SIZE
  const positions = sorted.map(p => ({ x: p.x / 100 * width, y: p.y / 100 * height }))
  const extents = positions.map(p => ({ minX: p.x, maxX: p.x, minY: p.y, maxY: p.y }))
  sorted.forEach((point, i) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("点位坐标无效")
    if (point.id === pinnedId) return
    const p = positions[i], cx = Math.floor(p.x / gap), cy = Math.floor(p.y / gap)
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const j of cells.get(`${x},${y}`) ?? []) {
        if (Math.abs(p.x - positions[j].x) >= gap || Math.abs(p.y - positions[j].y) >= gap) continue
        const a = find(i), b = find(j)
        if (a === b) continue
        const merged = { minX: Math.min(extents[a].minX, extents[b].minX), maxX: Math.max(extents[a].maxX, extents[b].maxX), minY: Math.min(extents[a].minY, extents[b].minY), maxY: Math.max(extents[a].maxY, extents[b].maxY) }
        // Bound the whole group: a chain of near neighbours must not swallow the floor.
        if (merged.maxX - merged.minX > gap || merged.maxY - merged.minY > gap) continue
        parent[a] = b
        extents[b] = merged
      }
    }
    const key = `${cx},${cy}`
    cells.set(key, [...(cells.get(key) ?? []), i])
  })
  const groups = new Map<number, EditorAnchor[]>()
  sorted.forEach((point, i) => { const root = find(i); groups.set(root, [...(groups.get(root) ?? []), point]) })
  return [...groups.values()].map(members => ({ id: JSON.stringify(members.map(p => p.id)), pointIds: members.map(p => p.id), x: members.reduce((sum, p) => sum + p.x, 0) / members.length, y: members.reduce((sum, p) => sum + p.y, 0) / members.length }))
}

/** Recenter a chosen installation point/group by moving only the camera. */
export function focusPointMapEditorView(geometry: Geometry, points: readonly Pick<EditorAnchor, "x" | "y">[], viewport: { width: number; height: number }, currentZoom: number) {
  if (!points.length) throw new Error("请选择需要定位的点位")
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2
  const baseWidth = geometry.width * geometry.fitScale, baseHeight = geometry.height * geometry.fitScale
  const localZoom = points.length > 1
    ? Math.min(Math.max(1, viewport.width - 100) / (Math.max(1, maxX - minX) / 100 * baseWidth), Math.max(1, viewport.height - 100) / (Math.max(1, maxY - minY) / 100 * baseHeight))
    : 1400 / Math.max(baseWidth, baseHeight)
  const zoom = Math.max(1, Math.min(POINT_MAP_MAX_EDITOR_ZOOM, Math.max(currentZoom, localZoom)))
  return { zoom, pan: { x: (50 - x) / 100 * baseWidth * zoom, y: (50 - y) / 100 * baseHeight * zoom } }
}
