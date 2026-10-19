import { findPointIconById, pointIconDefinitions } from "./point-icons"
import type { QuoteDraftProduct } from "./quote-draft"
import type { PointMapCadBinding } from "./point-map-cad-contract"
import type { DeviceSpecs } from "./device-types"
import { canExpandProductToPoints, deviceIntentForIcon, iconForSelectionProduct, type PointSelectionSnapshot } from "./product-selection"
import type { PointMaterial } from "./point-materials"

export const POINT_MAP_STORAGE_PREFIX = "fmkj:point-map:"
export const POINT_MAP_SYMBOL_VERSION = 1 as const
export class PointMapFormatError extends Error {}

export type PointMapStatus = "pending" | "planned" | "confirmed" | "changed"

export type PointMapPosition = {
  x: number
  y: number
}

/** Display-only offsets in presentation-image percentages; never installation coordinates. */
export type PointMapDisplayPlacement = {
  markerOffset: PointMapPosition
  /** Offset from the centered label immediately below the product circle. */
  labelOffset: PointMapPosition
}

export function normalizePointMapDisplay(value: unknown): PointMapDisplayPlacement | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PointMapFormatError("商品圆图展示偏移格式无效。")
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== "markerOffset" && key !== "labelOffset")) throw new PointMapFormatError("商品圆图展示偏移包含未知字段。")
  const position = (value: unknown): PointMapPosition => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PointMapFormatError("商品圆图展示偏移缺少坐标。")
    const coordinates = value as Record<string, unknown>
    if (Object.keys(coordinates).some((key) => key !== "x" && key !== "y") || ![coordinates.x, coordinates.y].every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 20)) throw new PointMapFormatError("商品圆图展示偏移必须在 -20% 到 20% 之间。")
    return { x: coordinates.x as number, y: coordinates.y as number }
  }
  return { markerOffset: position(input.markerOffset), labelOffset: position(input.labelOffset) }
}

/** Engineering image percentages to presentation image percentages. */
export type PresentationAffineMatrix = [number, number, number, number, number, number]
export type PresentationAnchor = { source: PointMapPosition; target: PointMapPosition }
export type PointMapPresentation = {
  name: string
  imageDataUrl: string
  imageWidth: number
  imageHeight: number
  sourceFingerprint: string
  matrix: PresentationAffineMatrix
  anchors: PresentationAnchor[]
}

export type PointMapNode = {
  id: string
  name: string
  room: string
  iconId: string
  status: PointMapStatus
  x: number
  y: number
  productId: string
  note: string
  placed: boolean
  floorId?: string
  code?: string
  controlTargets?: string[]
  controlType?: string
  reviewReason?: string
  confidence?: "low" | "medium" | "high"
  source?: "manual" | "analysis" | "quote"
  deviceTypeId?: string
  requirements?: DeviceSpecs
  usage?: "proposed" | "selected" | "reserve"
  selection?: PointSelectionSnapshot
  materials?: PointMaterial[]
  display?: PointMapDisplayPlacement
}

export type PointMapFloor = {
  id: string
  name: string
  floorplanName: string
  floorplanDataUrl: string
  imageWidth: number
  imageHeight: number
  sourcePage?: number
  cad?: PointMapCadBinding
  /** Independent, point-free customer background; engineering coordinates stay unchanged. */
  presentation?: PointMapPresentation
  /** Calibrated design references; layout remains the engineering coordinate source. */
  references?: Partial<Record<"lighting" | "switch", PointMapPresentation>>
  /** 楼层可选房间清单；未设置时使用户型默认房间。 */
  rooms?: string[]
}

export type PointMapScene = {
  id: string
  name: string
  trigger: string
  description: string
  pointIds: string[]
  status: "proposed" | "confirmed"
}

export type PointMapPlan = {
  projectId: string
  floorplanName: string
  floorplanDataUrl: string
  points: PointMapNode[]
  updatedAt: string
  schemaVersion?: 2 | 3
  symbolVersion?: 1
  floors?: PointMapFloor[]
  activeFloorId?: string
  scenes?: PointMapScene[]
}

export type PointMapRoomSummary = {
  room: string
  total: number
  confirmed: number
}

export type PointMapStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type AddPointInput = {
  iconId: string
  room: string
  productId?: string
  position: PointMapPosition
  floorId?: string
  code?: string
}

export type QueuePointInput = {
  product: QuoteDraftProduct
  projectId: string
  quantity?: number
  room: string
  floorId?: string
}

type Clock = () => string
type IdGenerator = () => string

type MutationOptions = {
  now?: Clock
  createId?: IdGenerator
}

export function pointMapStorageKey(projectId: string) {
  return `${POINT_MAP_STORAGE_PREFIX}${projectId}`
}

export function emptyPointMapPlan(projectId: string, now: Clock = defaultNow): PointMapPlan {
  return {
    floorplanDataUrl: "",
    floorplanName: "",
    points: [],
    projectId,
    updatedAt: now(),
  }
}

export function readPointMapPlan(
  projectId: string,
  storage: PointMapStorage | undefined = browserPointMapStorage(),
  options: Pick<MutationOptions, "now" | "createId"> = {}
): PointMapPlan {
  if (!storage) return emptyPointMapPlan(projectId, options.now)

  try {
    const raw = storage.getItem(pointMapStorageKey(projectId))
    const parsed = raw ? (JSON.parse(raw) as Partial<PointMapPlan>) : null

    if (parsed?.schemaVersion !== undefined && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3)
      throw new PointMapFormatError("不支持的点位方案版本，请更新工作台后再读取，原缓存已保留。")

    if (parsed?.projectId === projectId && Array.isArray(parsed.points)) {
      return {
        ...parsed,
        floorplanDataUrl: String(parsed.floorplanDataUrl ?? ""),
        floorplanName: String(parsed.floorplanName ?? ""),
        points: parsed.points.map((point) => normalizePoint(point, options.createId)).filter(Boolean),
        projectId,
        updatedAt: String(parsed.updatedAt ?? currentTime(options.now)),
      }
    }
  } catch (error) {
    if (error instanceof PointMapFormatError) throw error
    return emptyPointMapPlan(projectId, options.now)
  }

  return emptyPointMapPlan(projectId, options.now)
}

export function writePointMapPlan(plan: PointMapPlan, storage: PointMapStorage | undefined = browserPointMapStorage()) {
  storage?.setItem(pointMapStorageKey(plan.projectId), JSON.stringify(plan))
}

export function applyPointMapPlanPatch(
  plan: PointMapPlan,
  patch: Partial<Omit<PointMapPlan, "projectId">>,
  options: Pick<MutationOptions, "now"> = {}
): PointMapPlan {
  return {
    ...plan,
    ...patch,
    projectId: plan.projectId,
    updatedAt: currentTime(options.now),
  }
}

export function addPointToPlan(plan: PointMapPlan, input: AddPointInput, options: MutationOptions = {}) {
  const currentPoints = withPointMapPointCodes(plan.points)
  const icon = findPointIconById(input.iconId) ?? pointIconDefinitions[0]
  const point: PointMapNode = {
    ...deviceIntentForIcon(icon.id),
    usage: "proposed",
    iconId: icon.id,
    id: createPointId(options.createId),
    name: `${input.room}${icon.name}${plan.points.length + 1}`,
    note: "",
    placed: true,
    productId: input.productId ?? "",
    room: input.room,
    status: "planned",
    source: "manual",
    ...(input.floorId || plan.activeFloorId ? { floorId: input.floorId || plan.activeFloorId } : {}),
    code: input.code?.trim() ? input.code : nextPointMapPointCode(currentPoints),
    x: input.position.x,
    y: input.position.y,
  }

  return {
    plan: applyPointMapPlanPatch(plan, { points: [...currentPoints, point] }, options),
    point,
  }
}

export function placePendingPoint(plan: PointMapPlan, pointId: string, position: PointMapPosition, options: MutationOptions = {}) {
  return updatePointInPlan(plan, pointId, { placed: true, status: "planned", ...position }, options)
}

export function movePointInPlan(plan: PointMapPlan, pointId: string, position: PointMapPosition, options: MutationOptions = {}) {
  const point = plan.points.find((item) => item.id === pointId)
  const moved = point && (point.x !== position.x || point.y !== position.y)
  return updatePointInPlan(plan, pointId, {
    ...position,
    ...(moved && point.status === "confirmed" ? { status: "changed" } : {}),
  }, options)
}

export function patchPointInPlan(plan: PointMapPlan, pointId: string, patch: Partial<PointMapNode>, options: MutationOptions = {}) {
  return updatePointInPlan(plan, pointId, patch, options)
}

export function removePointFromPlan(plan: PointMapPlan, pointId: string, options: MutationOptions = {}) {
  return applyPointMapPlanPatch(
    plan,
    {
      points: plan.points.filter((point) => point.id !== pointId),
      ...(plan.scenes ? {
        scenes: plan.scenes.map((scene) => scene.pointIds.includes(pointId)
          ? { ...scene, pointIds: scene.pointIds.filter((id) => id !== pointId), status: "proposed" as const }
          : scene),
      } : {}),
    },
    options
  )
}

export function queueProductPoints(plan: PointMapPlan, input: QueuePointInput, options: MutationOptions = {}) {
  const currentPoints = withPointMapPointCodes(plan.points)
  const nextCode = pointCodeGenerator(currentPoints)
  const count = input.quantity ?? 1
  const iconId = iconForSelectionProduct(input.product)
  // Fractional quantities and measured materials never become rounded device counts.
  if (!iconId || !canExpandProductToPoints(input.product) || !Number.isSafeInteger(count) || count < 1 || count > 10000) {
    return { plan, points: [] as PointMapNode[] }
  }
  const icon = findPointIconById(iconId) ?? pointIconDefinitions[0]
  const points = Array.from({ length: count }, (_, index): PointMapNode => ({
    deviceTypeId: input.product.deviceTypeId ?? undefined,
    requirements: {},
    usage: "proposed",
    iconId,
    id: createPointId(options.createId),
    name: `${input.room}${icon.name}${plan.points.length + index + 1}`,
    note: `由报价单产品生成：${input.product.name}`,
    placed: false,
    productId: input.product.id,
    room: input.room,
    status: "pending",
    source: "quote",
    code: nextCode(),
    ...(input.floorId || plan.activeFloorId ? { floorId: input.floorId || plan.activeFloorId } : {}),
    x: 50,
    y: 50,
  }))

  return {
    plan: applyPointMapPlanPatch(plan, { points: [...currentPoints, ...points] }, options),
    points,
  }
}

/** Preserve explicit codes and fill missing codes without stealing a later explicit number. */
export function withPointMapPointCodes(points: readonly PointMapNode[]): PointMapNode[] {
  const nextCode = pointCodeGenerator(points)
  return points.map((point) => ({ ...point, code: point.code?.trim() ? point.code : nextCode() }))
}

export function nextPointMapPointCode(points: readonly PointMapNode[]): string {
  // Account for missing legacy codes too, even before the caller normalizes its plan.
  return pointCodeGenerator(withPointMapPointCodes(points))()
}

function pointCodeGenerator(points: readonly PointMapNode[]): () => string {
  const used = new Set(points.flatMap((point) => point.code?.trim() ? [point.code.trim()] : []))
  let index = 1
  return () => {
    let code = `P${String(index).padStart(3, "0")}`
    while (used.has(code)) {
      index += 1
      code = `P${String(index).padStart(3, "0")}`
    }
    used.add(code)
    index += 1
    return code
  }
}

let browserProductQueue = Promise.resolve();
export async function queuePointMapProduct(input: QueuePointInput, storage?: PointMapStorage) {
  if (!input.projectId) return
  if (storage) {
    const result = queueProductPoints(readPointMapPlan(input.projectId, storage), input)
    writePointMapPlan(result.plan, storage)
    return
  }
  if (typeof window === "undefined") return
  const work = browserProductQueue.catch(() => {}).then(async () => {
    const { pointMapLocalStore } = await import("./point-map-local-store")
    const local = pointMapLocalStore()
    let plan = (await local.read(input.projectId))?.plan
    // A quote can be opened before the point workbench in a fresh browser.
    if (!plan && /^[0-9a-f-]{36}$/i.test(input.projectId)) {
      const response = await fetch(`/api/projects/${encodeURIComponent(input.projectId)}/point-map`, { cache: "no-store" })
      if (!response.ok) throw new Error("无法读取项目点位，尚未加入本次商品，请恢复连接后重试。")
      plan = ((await response.json()) as { data: PointMapPlan | null }).data ?? undefined
    }
    const result = queueProductPoints(plan ?? emptyPointMapPlan(input.projectId), input)
    await local.write(result.plan)
  });
  browserProductQueue = work;
  await work;
}

/** Symbols follow structured device identity; prose remains searchable product information. */
export function mapProductToPointIcon(product: QuoteDraftProduct) {
  return iconForSelectionProduct(product) ?? "data-point"
}

export function summarizePointMapRooms(points: PointMapNode[]): PointMapRoomSummary[] {
  const stats = new Map<string, PointMapRoomSummary>()

  for (const point of points) {
    const current = stats.get(point.room) ?? { confirmed: 0, room: point.room, total: 0 }
    current.total += 1
    if (point.status === "confirmed") current.confirmed += 1
    stats.set(point.room, current)
  }

  return Array.from(stats.values())
}

function updatePointInPlan(
  plan: PointMapPlan,
  pointId: string,
  patch: Partial<PointMapNode>,
  options: MutationOptions
) {
  return applyPointMapPlanPatch(
    plan,
    { points: plan.points.map((point) => (point.id === pointId ? { ...point, ...patch } : point)) },
    options
  )
}

function normalizePoint(point: Partial<PointMapNode> & { kind?: string }, createId: IdGenerator = defaultCreateId): PointMapNode {
  const legacyIconId = point.iconId || fallbackIconByLegacyKind(String(point.kind ?? "")) || "switch-1"

  return {
    ...point,
    usage: point.usage ?? "proposed",
    iconId: legacyIconId,
    id: String(point.id || createId()),
    name: String(point.name || findPointIconById(legacyIconId)?.name || "点位"),
    note: String(point.note ?? ""),
    placed: point.placed ?? point.status !== "pending",
    productId: String(point.productId ?? ""),
    room: String(point.room || "未分配"),
    status: isPointStatus(point.status) ? point.status : "planned",
    x: Number.isFinite(point.x) ? Number(point.x) : 50,
    y: Number.isFinite(point.y) ? Number(point.y) : 50,
    ...(point.display === undefined ? {} : { display: normalizePointMapDisplay(point.display) }),
  }
}

function isPointStatus(status: unknown): status is PointMapStatus {
  return status === "pending" || status === "planned" || status === "confirmed" || status === "changed"
}

function fallbackIconByLegacyKind(kind: string) {
  const map: Record<string, string> = {
    camera: "camera",
    gateway: "gateway",
    lighting: "downlight",
    network: "ap",
    other: "data-point",
    sensor: "sensor",
    socket: "socket",
    switch: "switch-1",
  }

  return map[kind]
}

function browserPointMapStorage(): PointMapStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage
}

function currentTime(now: Clock = defaultNow) {
  return now()
}

function defaultNow() {
  return new Date().toISOString()
}

function createPointId(createId: IdGenerator = defaultCreateId) {
  return createId()
}

function defaultCreateId() {
  return crypto.randomUUID()
}
