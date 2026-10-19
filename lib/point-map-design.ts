import { findPointIconById } from "./point-icons"
import { parseCadBinding } from "./point-map-cad-contract"
import { findDeviceType, normalizeDeviceSpecs } from "./device-types"
import { normalizePointSelectionSnapshot } from "./product-selection"
import { normalizePointMaterials } from "./point-materials"
import { normalizeRoomName } from "./point-map-rooms"
import { parsePointMapPresentation } from "./point-map-presentation"
import { parseReferenceDrawings } from "./point-map-reference-drawings"
import { defaultSpacesForPropertyType } from "./project-spaces"
import {
  withPointMapPointCodes,
  normalizePointMapDisplay,
  POINT_MAP_SYMBOL_VERSION,
  type PointMapFloor,
  type PointMapNode,
  type PointMapPlan,
  type PointMapScene
} from "./point-map-plan"

export const DEFAULT_POINT_MAP_FLOOR_ID = "floor-default"

const systemFloorNames = new Map([
  [DEFAULT_POINT_MAP_FLOOR_ID, "默认楼层"],
  ...[...defaultSpacesForPropertyType("flat"), ...defaultSpacesForPropertyType("villa")]
    .map((space): [string, string] => [space.id, space.name]),
])

function isEmptySystemFloor(floor: PointMapFloor) {
  return systemFloorNames.get(floor.id) === floor.name &&
    !floor.floorplanName && !floor.floorplanDataUrl &&
    !floor.imageWidth && !floor.imageHeight &&
    floor.sourcePage === undefined && !floor.cad && !floor.presentation &&
    floor.rooms === undefined
}

/** System-seeded empty rooms are placeholders, not unsaved design edits. */
export function isPristinePointMapTemplate(plan: PointMapPlan): boolean {
  if (plan.points.length || plan.scenes?.length || plan.floorplanName || plan.floorplanDataUrl) return false
  return normalizeDesignPlan(plan).floors!.every(isEmptySystemFloor)
}

export type PointMapDraft = {
  format: "fmkj-point-map-draft"
  version: 1 | 2
  symbolVersion?: 1
  coordinateSystem: "image-percent"
  floors: PointMapFloor[]
  points: Array<PointMapNode & { floorId: string }>
  scenes: PointMapScene[]
}

const floorKeys = [
  "id",
  "name",
  "floorplanName",
  "floorplanDataUrl",
  "imageWidth",
  "imageHeight",
  "sourcePage",
  "cad",
  "presentation",
  "references",
  "rooms"
]
const pointKeys = [
  "id",
  "name",
  "room",
  "iconId",
  "status",
  "x",
  "y",
  "productId",
  "note",
  "placed",
  "floorId",
  "code",
  "controlTargets",
  "controlType",
  "reviewReason",
  "confidence",
  "source",
  "deviceTypeId",
  "requirements",
  "usage",
  "selection",
  "materials",
  "display"
]
const sceneKeys = ["id", "name", "trigger", "description", "pointIds", "status"]
const planKeys = [
  "projectId",
  "floorplanName",
  "floorplanDataUrl",
  "points",
  "updatedAt",
  "schemaVersion",
  "symbolVersion",
  "floors",
  "activeFloorId",
  "scenes"
]

/** Migrate the single-image workspace without changing point IDs or user edits. */
export function normalizeDesignPlan(plan: PointMapPlan): PointMapPlan {
  if (plan.schemaVersion !== undefined && plan.schemaVersion !== 2 && plan.schemaVersion !== 3)
    fail("不支持的点位方案版本")
  if (plan.symbolVersion !== undefined && plan.symbolVersion !== POINT_MAP_SYMBOL_VERSION) fail("不支持的图形库版本")
  const floors = plan.floors?.length
    ? plan.floors.map((floor) => ({ ...floor, ...(floor.presentation ? { presentation: structuredClone(floor.presentation) } : {}) }))
    : [
        {
          id: DEFAULT_POINT_MAP_FLOOR_ID,
          name: "默认楼层",
          floorplanName: plan.floorplanName,
          floorplanDataUrl: plan.floorplanDataUrl,
          imageWidth: 0,
          imageHeight: 0
        }
      ]
  const active = floors.find((floor) => floor.id === plan.activeFloorId) ?? floors[0]
  return {
    ...plan,
    schemaVersion: 3,
    symbolVersion: plan.symbolVersion ?? POINT_MAP_SYMBOL_VERSION,
    floors,
    activeFloorId: active.id,
    floorplanName: active.floorplanName,
    floorplanDataUrl: active.floorplanDataUrl,
    points: withPointMapPointCodes(plan.points).map((point) => ({
      ...point,
      usage: point.usage ?? "proposed",
      ...(point.requirements ? { requirements: { ...point.requirements } } : {}),
      ...(point.materials ? { materials: structuredClone(point.materials) } : {}),
      ...(point.selection ? { selection: structuredClone(point.selection) } : {}),
      ...(point.display === undefined ? {} : { display: normalizePointMapDisplay(point.display) }),
      floorId: point.floorId || active.id,
      ...(point.controlTargets ? { controlTargets: [...point.controlTargets] } : {})
    })),
    scenes: (plan.scenes ?? []).map((scene) => ({ ...scene, pointIds: [...scene.pointIds] }))
  }
}

/** Validate before any server write. Normalization never repairs invalid references. */
export function validateDesignPlan(value: unknown, projectId?: string): PointMapPlan {
  const input = object(value, "点位方案")
  keys(input, planKeys, "点位方案")
  const owner = identifier(input.projectId, "projectId")
  if (projectId !== undefined && owner !== projectId) fail("点位方案不属于当前项目")
  if (input.schemaVersion !== undefined && input.schemaVersion !== 2 && input.schemaVersion !== 3) fail("不支持的点位方案版本")
  if (input.symbolVersion !== undefined && input.symbolVersion !== POINT_MAP_SYMBOL_VERSION) fail("不支持的图形库版本")
  const updatedAt = text(input.updatedAt, "updatedAt", 100, false)
  if (!Number.isFinite(Date.parse(updatedAt))) fail("updatedAt 必须是有效时间")
  const floorplanName = text(input.floorplanName, "floorplanName", 500)
  const floorplanDataUrl = imageDataUrl(input.floorplanDataUrl, "floorplanDataUrl")
  const floors = input.floors === undefined ? undefined : floorArray(input.floors)
  if ((input.schemaVersion === 2 || input.schemaVersion === 3) && !floors) fail("版本化点位方案必须包含楼层")
  if (floors && floors.length === 0) fail("方案至少需要一个楼层")
  const activeFloorId =
    input.activeFloorId === undefined ? undefined : identifier(input.activeFloorId, "activeFloorId")
  if (floors && activeFloorId && !floors.some((floor) => floor.id === activeFloorId))
    fail("activeFloorId 引用了不存在的楼层")
  if (!floors && activeFloorId && activeFloorId !== DEFAULT_POINT_MAP_FLOOR_ID)
    fail("activeFloorId 引用了不存在的楼层")
  const points = array(input.points, "points", 10000).map((point, index) =>
    parsePoint(point, `points[${index}]`, Boolean(floors))
  )
  uniqueIds(points, "点位")
  const scenes = input.scenes === undefined ? [] : sceneArray(input.scenes)
  const plan = normalizeDesignPlan({
    projectId: owner,
    floorplanName,
    floorplanDataUrl,
    points,
    updatedAt,
    ...(floors ? { floors } : {}),
    ...(activeFloorId ? { activeFloorId } : {}),
    scenes
  })
  validateReferences(plan.floors!, plan.points, scenes)
  return plan
}

/** A draft is an all-or-nothing, portable file; it is never executed as instructions. */
export function parsePointMapDraft(value: unknown): PointMapDraft {
  let parsed = value
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value)
    } catch {
      fail("草稿不是有效的 JSON 文件")
    }
  }
  const input = object(parsed, "点位草稿")
  keys(input, ["format", "version", "symbolVersion", "coordinateSystem", "floors", "points", "scenes"], "点位草稿")
  if (input.format !== "fmkj-point-map-draft") fail("不是 FMKJ 点位草稿文件")
  if (input.version !== 1 && input.version !== 2) fail("不支持的草稿版本")
  if (input.symbolVersion !== undefined && input.symbolVersion !== POINT_MAP_SYMBOL_VERSION) fail("不支持的图形库版本")
  if (input.coordinateSystem !== "image-percent") fail("草稿坐标必须是原图百分比 image-percent")
  const floors = floorArray(input.floors)
  if (!floors.length) fail("草稿至少需要一个楼层")
  const points = array(input.points, "points", 10000).map((point, index) =>
    parsePoint(point, `points[${index}]`, true)
  ) as PointMapDraft["points"]
  uniqueIds(points, "点位")
  const scenes = sceneArray(input.scenes)
  validateReferences(floors, points, scenes)
  return {
    format: "fmkj-point-map-draft",
    version: 2,
    symbolVersion: POINT_MAP_SYMBOL_VERSION,
    coordinateSystem: "image-percent",
    floors,
    points,
    scenes
  }
}

export function importPointMapDraft(
  plan: PointMapPlan,
  draft: PointMapDraft
): { plan: PointMapPlan; added: number; skipped: number } {
  // Revalidate even when callers obtained a typed object without using the parser.
  const input = parsePointMapDraft(draft)
  const current = normalizeDesignPlan(plan)
  // Only untouched system placeholders can be replaced. A renamed floor,
  // custom room list, drawing or existing point makes it user-owned content.
  const emptyTemplateIds = new Set(current.floors!.filter((floor) =>
    isEmptySystemFloor(floor) &&
    !current.points.some((point) => point.floorId === floor.id)
  ).map((floor) => floor.id))
  for (const incoming of input.floors) {
    const existing = current.floors!.find((floor) => floor.id === incoming.id)
    if (!existing || emptyTemplateIds.has(existing.id)) continue
    const differentPage =
      existing.sourcePage !== undefined &&
      incoming.sourcePage !== undefined &&
      existing.sourcePage !== incoming.sourcePage
    const differentSize =
      existing.imageWidth > 0 &&
      incoming.imageWidth > 0 &&
      (existing.imageWidth !== incoming.imageWidth || existing.imageHeight !== incoming.imageHeight)
    const differentImage =
      existing.floorplanDataUrl &&
      incoming.floorplanDataUrl &&
      existing.floorplanDataUrl !== incoming.floorplanDataUrl
    const differentCad = Boolean(existing.cad) !== Boolean(incoming.cad) ||
      (existing.cad && incoming.cad && JSON.stringify(parseCadBinding(existing.cad)) !== JSON.stringify(incoming.cad))
    if (differentCad)
      fail(`楼层 ${incoming.id} 的 CAD 绑定与现有方案不一致；请使用当前导出的完整草稿，或使用不同的楼层 ID`)
    if (differentPage || differentSize || differentImage) {
      fail(`楼层 ${incoming.id} 与现有底图不一致；请核对图纸页码和尺寸，或使用不同的楼层 ID`)
    }
  }
  const pointIds = new Set(current.points.map((point) => point.id))
  const sceneIds = new Set(current.scenes!.map((scene) => scene.id))
  const newPoints = input.points
    .filter((point) => !pointIds.has(point.id))
    .map((point) => ({
      ...point,
      status:
        point.reviewReason || point.confidence === "low" || point.confidence === "medium"
          ? ("changed" as const)
          : ("planned" as const),
      source: point.source ?? ("analysis" as const)
    }))
  const pristineTemplate =
    !current.points.length && !current.scenes!.length &&
    current.floors!.every((floor) => emptyTemplateIds.has(floor.id))
  const incomingById = new Map(input.floors.map((floor) => [floor.id, floor]))
  const retainedFloors = pristineTemplate ? [] : current.floors!.map((floor) =>
    emptyTemplateIds.has(floor.id) ? incomingById.get(floor.id) ?? floor : floor
  )
  const floorIds = new Set(retainedFloors.map((floor) => floor.id))
  const newFloors = input.floors.filter((floor) => !floorIds.has(floor.id))
  const newScenes = input.scenes
    .filter((scene) => !sceneIds.has(scene.id))
    .map((scene) => ({ ...scene, status: "proposed" as const }))
  const floors = [...retainedFloors, ...newFloors]
  const activeFloorId = pristineTemplate ? floors[0].id : current.activeFloorId
  const mergedTemplate = retainedFloors.some((floor, index) => floor !== current.floors![index])
  const merged = normalizeDesignPlan({
    ...current,
    floors,
    activeFloorId,
    points: [...current.points, ...newPoints],
    scenes: [...current.scenes!, ...newScenes],
    updatedAt:
      newPoints.length || newFloors.length || newScenes.length || mergedTemplate ? new Date().toISOString() : current.updatedAt
  })
  validateReferences(merged.floors!, merged.points, merged.scenes!)
  return { plan: merged, added: newPoints.length, skipped: input.points.length - newPoints.length }
}

export function exportPointMapDraft(plan: PointMapPlan): PointMapDraft {
  const normalized = validateDesignPlan(plan)
  return parsePointMapDraft({
    format: "fmkj-point-map-draft",
    version: 2,
    symbolVersion: normalized.symbolVersion,
    coordinateSystem: "image-percent",
    floors: normalized.floors,
    points: normalized.points,
    scenes: normalized.scenes
  })
}

export function activePointMapFloor(plan: PointMapPlan): PointMapFloor | undefined {
  return plan.floors?.find((floor) => floor.id === plan.activeFloorId) ?? plan.floors?.[0]
}

function parseFloor(value: unknown, path: string): PointMapFloor {
  const input = object(value, path)
  keys(input, floorKeys, path)
  const imageWidth = number(input.imageWidth, `${path}.imageWidth`, 0, 100000)
  const imageHeight = number(input.imageHeight, `${path}.imageHeight`, 0, 100000)
  if (
    !Number.isInteger(imageWidth) ||
    !Number.isInteger(imageHeight) ||
    (imageWidth === 0) !== (imageHeight === 0)
  )
    fail(`${path} 的图片宽高必须同时为正整数或同时为 0`)
  const floor: PointMapFloor = {
    id: identifier(input.id, `${path}.id`),
    name: text(input.name, `${path}.name`, 256, false),
    floorplanName: text(input.floorplanName, `${path}.floorplanName`, 500),
    floorplanDataUrl: imageDataUrl(input.floorplanDataUrl, `${path}.floorplanDataUrl`),
    imageWidth,
    imageHeight
  }
  if (input.sourcePage !== undefined) {
    floor.sourcePage = number(input.sourcePage, `${path}.sourcePage`, 1, 100000)
    if (!Number.isInteger(floor.sourcePage)) fail(`${path}.sourcePage 必须是整数页码`)
  }
  if (input.cad !== undefined) {
    if (!floor.floorplanDataUrl || !imageWidth || !imageHeight) fail(`${path} 的 CAD 绑定需要完整底图与尺寸`)
    floor.cad = parseCadBinding(input.cad)
    const [xmin, ymin, xmax, ymax] = floor.cad.window
    const cadAspect = (xmax - xmin) / (ymax - ymin)
    if (Math.abs(imageWidth / imageHeight - cadAspect) / cadAspect > 0.005)
      fail(`${path} 的 CAD 坐标窗口与底图比例不符`)
  }
  if (input.presentation !== undefined) {
    if (!floor.floorplanDataUrl || !imageWidth || !imageHeight) fail(`${path} 的风格底图需要先保留完整工程底图与尺寸`)
    floor.presentation = parsePointMapPresentation(input.presentation, `${path}.presentation`)
  }
  if (input.references !== undefined) {
    if (!floor.floorplanDataUrl || !imageWidth || !imageHeight) fail(`${path} 的对照图需要先保留完整布局底图与尺寸`)
    floor.references = parseReferenceDrawings(input.references)
  }
  if (input.rooms !== undefined) {
    floor.rooms = stringArray(input.rooms, `${path}.rooms`, 200, 256).map(normalizeRoomName).filter(Boolean)
    if (new Set(floor.rooms).size !== floor.rooms.length) fail(`${path}.rooms 不能包含重复房间`)
  }
  return floor
}

function parsePoint(value: unknown, path: string, requireFloor: boolean): PointMapNode {
  const input = object(value, path)
  keys(input, requireFloor ? pointKeys : [...pointKeys, "kind"], path)
  const iconId = identifier(input.iconId, `${path}.iconId`)
  if (!findPointIconById(iconId)) fail(`${path}.iconId 是不支持的点位素材`)
  if (typeof input.placed !== "boolean") fail(`${path}.placed 必须是布尔值`)
  const point: PointMapNode = {
    id: identifier(input.id, `${path}.id`),
    name: text(input.name, `${path}.name`, 500, false),
    room: text(input.room, `${path}.room`, 256, false),
    iconId,
    status: choice(input.status, ["pending", "planned", "confirmed", "changed"] as const, `${path}.status`),
    x: number(input.x, `${path}.x`, 0, 100),
    y: number(input.y, `${path}.y`, 0, 100),
    productId: text(input.productId, `${path}.productId`, 200),
    note: text(input.note, `${path}.note`, 20000),
    placed: input.placed
  }
  if (requireFloor || input.floorId !== undefined)
    point.floorId = identifier(input.floorId, `${path}.floorId`)
  if (input.code !== undefined) {
    point.code = text(input.code, `${path}.code`, 100)
    if (invisibleIdentifierCharacters.test(point.code)) fail(`${path}.code 含不可见或方向控制字符`)
  }
  if (input.controlTargets !== undefined)
    point.controlTargets = stringArray(input.controlTargets, `${path}.controlTargets`, 100, 500)
  if (input.controlType !== undefined) point.controlType = text(input.controlType, `${path}.controlType`, 500)
  if (input.reviewReason !== undefined)
    point.reviewReason = text(input.reviewReason, `${path}.reviewReason`, 20000)
  if (input.confidence !== undefined)
    point.confidence = choice(input.confidence, ["low", "medium", "high"] as const, `${path}.confidence`)
  if (input.source !== undefined)
    point.source = choice(input.source, ["manual", "analysis", "quote"] as const, `${path}.source`)
  point.usage = input.usage === undefined ? "proposed" : choice(input.usage, ["proposed", "selected", "reserve"] as const, `${path}.usage`)
  if (input.deviceTypeId !== undefined) {
    point.deviceTypeId = identifier(input.deviceTypeId, `${path}.deviceTypeId`)
    if (!findDeviceType(point.deviceTypeId)) fail(`${path}.deviceTypeId 是未知设备类型`)
  }
  if (input.requirements !== undefined) {
    if (!point.deviceTypeId) fail(`${path}.requirements 需要先选择设备类型`)
    point.requirements = normalizeDeviceSpecs(point.deviceTypeId, input.requirements)
  }
  if (input.selection !== undefined) point.selection = normalizePointSelectionSnapshot(input.selection)
  if (input.materials !== undefined) point.materials = normalizePointMaterials(input.materials)
  if (input.display !== undefined) point.display = normalizePointMapDisplay(input.display)
  return point
}

function parseScene(value: unknown, path: string): PointMapScene {
  const input = object(value, path)
  keys(input, sceneKeys, path)
  const pointIds = stringArray(input.pointIds, `${path}.pointIds`, 10000, 200)
  if (new Set(pointIds).size !== pointIds.length) fail(`${path}.pointIds 不能重复引用同一个点位`)
  return {
    id: identifier(input.id, `${path}.id`),
    name: text(input.name, `${path}.name`, 500, false),
    trigger: text(input.trigger, `${path}.trigger`, 5000),
    description: text(input.description, `${path}.description`, 20000),
    pointIds,
    status: choice(input.status, ["proposed", "confirmed"] as const, `${path}.status`)
  }
}

function floorArray(value: unknown) {
  const result = array(value, "floors", 100).map((floor, index) => parseFloor(floor, `floors[${index}]`))
  uniqueIds(result, "楼层")
  return result
}

function sceneArray(value: unknown) {
  const result = array(value, "scenes", 2000).map((scene, index) => parseScene(scene, `scenes[${index}]`))
  uniqueIds(result, "场景")
  return result
}

function validateReferences(floors: PointMapFloor[], points: PointMapNode[], scenes: PointMapScene[]) {
  const floorIds = new Set(floors.map((floor) => floor.id))
  const pointIds = new Set(points.map((point) => point.id))
  for (const point of points)
    if (!point.floorId || !floorIds.has(point.floorId)) fail(`点位 ${point.id} 引用了不存在的楼层`)
  for (const scene of scenes)
    for (const id of scene.pointIds)
      if (!pointIds.has(id)) fail(`场景 ${scene.name} 引用了不存在的点位 ${id}`)
}

function uniqueIds(values: Array<{ id: string }>, label: string) {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) fail(`${label} ID 重复：${value.id}`)
    ids.add(value.id)
  }
}

function imageDataUrl(value: unknown, path: string) {
  const result = text(value, path, 30 * 1024 * 1024)
  if (!result) return result
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(result)
  if (!match || match[2].length % 4 !== 0) fail(`${path} 仅支持 PNG、JPEG、WebP 的 base64 图片`)
  let header: string
  try {
    header = atob(match[2].slice(0, 32))
  } catch {
    fail(`${path} 图片编码无效`)
  }
  const bytes = Array.from(header, (character) => character.charCodeAt(0))
  const supported =
    match[1] === "png"
      ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
      : match[1] === "webp"
        ? header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!supported) fail(`${path} 图片内容与格式不匹配`)
  return result
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} 必须是对象`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path} 含不支持的字段：${key}`)
}

function text(value: unknown, path: string, max: number, empty = true): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()))
    fail(`${path} 必须是${empty ? "" : "非空"}文本且不超过 ${max} 个字符`)
  return value
}

function identifier(value: unknown, path: string) {
  const result = text(value, path, 200, false)
  if (result !== result.trim() || invisibleIdentifierCharacters.test(result)) fail(`${path} 不是有效 ID`)
  return result
}

const invisibleIdentifierCharacters =
  /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${path} 必须是数组且不超过 ${max} 项`)
  return value
}

function stringArray(value: unknown, path: string, max: number, maxText: number) {
  return array(value, path, max).map((item, index) => text(item, `${path}[${index}]`, maxText, false))
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    fail(`${path} 必须是 ${min}–${max} 范围内的有限数字`)
  return value
}

function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T))
    fail(`${path} 必须是 ${values.join("、")} 之一`)
  return value as T
}

function fail(message: string): never {
  throw new Error(message)
}
