import { PointMapFormatError, type PointMapFloor, type PointMapPlan, type PointMapPosition, type PointMapPresentation, type PresentationAffineMatrix, type PresentationAnchor } from "./point-map-plan"

export type PresentationCalibration = {
  anchorCount: number
  maxResidualPercent: number
  rmsResidualPercent: number
}

export type PointMapBackground = {
  src: string
  width: number
  height: number
  transformPoint: (point: PointMapPosition) => PointMapPosition
  kind: "engineering" | "presentation"
  calibration?: PresentationCalibration
}

/** Strict saved contract: a style image never replaces the CAD source or its coordinates. */
export function parsePointMapPresentation(value: unknown, path = "风格底图"): PointMapPresentation {
  const input = record(value, ["name", "imageDataUrl", "imageWidth", "imageHeight", "sourceFingerprint", "matrix", "anchors"], path)
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 500) fail(`${path}.name 必须是非空图片名称`)
  const imageWidth = finite(input.imageWidth, `${path}.imageWidth`, 1, 100000)
  const imageHeight = finite(input.imageHeight, `${path}.imageHeight`, 1, 100000)
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)) fail(`${path} 的图片宽高必须为正整数`)
  if (typeof input.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.sourceFingerprint)) fail(`${path} 缺少有效的工程底图 SHA-256 指纹`)
  if (!Array.isArray(input.matrix) || input.matrix.length !== 6) fail(`${path} 校准矩阵必须包含六个有限数字`)
  const matrix = input.matrix.map((n) => finite(n, `${path} 校准矩阵`, -1e6, 1e6)) as PresentationAffineMatrix
  const [a, b, c, d] = matrix
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  if (scaleX < .1 || scaleX > 10 || scaleY < .1 || scaleY > 10 || a * d - b * c <= 1e-8 * scaleX * scaleY) {
    fail(`${path} 校准矩阵无效：不能镜像、退化或使用异常比例`)
  }
  for (const corner of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]) {
    const mapped = transformPoint(matrix, corner)
    if (mapped.x < -5 || mapped.x > 105 || mapped.y < -5 || mapped.y > 105) fail(`${path} 校准后工程底图范围超出风格图片，请复核裁切与比例`)
  }
  if (!Array.isArray(input.anchors) || input.anchors.length < 3 || input.anchors.length > 100) fail(`${path} 校准至少需要三个非共线锚点，最多一百个`)
  const anchors = input.anchors.map((value, index): PresentationAnchor => {
    const anchorPath = `${path}.anchors[${index}]`
    const anchor = record(value, ["source", "target"], anchorPath)
    return {
      source: position(anchor.source, `${anchorPath}.source`, 0, 100),
      target: position(anchor.target, `${anchorPath}.target`, -5, 105),
    }
  })
  const xs = anchors.map((anchor) => anchor.source.x)
  const ys = anchors.map((anchor) => anchor.source.y)
  if (Math.max(...xs) - Math.min(...xs) < 50 || Math.max(...ys) - Math.min(...ys) < 50) fail(`${path} 校准锚点需覆盖建筑主体，工程横纵跨度各至少 50%`)
  const first = anchors[0].source
  const second = anchors.find(({ source }) => Math.hypot(source.x - first.x, source.y - first.y) > 1e-6)?.source
  if (!second || !anchors.some(({ source }) => Math.abs((second.x - first.x) * (source.y - first.y) - (second.y - first.y) * (source.x - first.x)) > 1e-4)) fail(`${path} 校准锚点不能共线`)
  const result: PointMapPresentation = {
    name: input.name,
    imageDataUrl: imageSource(input.imageDataUrl, `${path}.imageDataUrl`),
    imageWidth,
    imageHeight,
    sourceFingerprint: input.sourceFingerprint,
    matrix,
    anchors,
  }
  if (measurePresentationCalibration(result).maxResidualPercent > 2 + 1e-8) fail(`${path} 校准残差超过 2%，请重新校准工程图与风格图`)
  return result
}

/** Residuals remain inspectable from the persisted anchors, including AI redraw differences. */
export function measurePresentationCalibration(presentation: Pick<PointMapPresentation, "matrix" | "anchors">): PresentationCalibration {
  const residuals = presentation.anchors.map(({ source, target }) => {
    const mapped = transformPoint(presentation.matrix, source)
    return Math.hypot(mapped.x - target.x, mapped.y - target.y)
  })
  return {
    anchorCount: residuals.length,
    maxResidualPercent: Math.max(0, ...residuals),
    rmsResidualPercent: residuals.length ? Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length) : 0,
  }
}

/** Hash the exact source string so any engineering image replacement invalidates its calibration. */
export async function fingerprintFloorplan(source: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function resolvePointMapBackground(floor: PointMapFloor, mode: "engineering" | "presentation" = "presentation"): Promise<PointMapBackground> {
  if (!floor.floorplanDataUrl) fail(`${floor.name} 尚未上传工程底图`)
  if (mode === "engineering" || !floor.presentation) {
    return {
      kind: "engineering", src: floor.floorplanDataUrl, width: floor.imageWidth, height: floor.imageHeight,
      transformPoint: ({ x, y }) => ({ x, y }),
    }
  }
  const presentation = parsePointMapPresentation(floor.presentation)
  if (await fingerprintFloorplan(floor.floorplanDataUrl) !== presentation.sourceFingerprint) {
    fail(`${floor.name} 的工程底图已变更，风格底图校准已失效，请重新校准后导出；也可明确选择工程图。`)
  }
  return {
    kind: "presentation", src: presentation.imageDataUrl, width: presentation.imageWidth, height: presentation.imageHeight,
    transformPoint: (point) => transformPoint(presentation.matrix, point),
    calibration: measurePresentationCalibration(presentation),
  }
}

/** Apply calibrated backgrounds as one draft edit, preserving all engineering and design data. */
export async function applyPointMapPresentationBundle(plan: PointMapPlan, value: unknown): Promise<PointMapPlan> {
  let parsed = value
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) } catch { return fail("风格底图文件不是有效 JSON") }
  }
  const input = record(parsed, ["format", "version", "projectId", "floors"], "风格底图文件")
  if (input.format !== "fmkj-point-map-presentations" || input.version !== 1) fail("不是支持的风格底图文件格式或版本")
  if (input.projectId !== plan.projectId) fail("风格底图文件不属于当前项目")
  if (!Array.isArray(input.floors) || input.floors.length < 1 || input.floors.length > 100) fail("风格底图文件必须包含 1 到 100 个楼层")
  const floorById = new Map(plan.floors?.map((floor) => [floor.id, floor]) ?? [])
  const replacements = new Map<string, PointMapPresentation>()
  for (const [index, value] of input.floors.entries()) {
    const path = `风格底图文件.floors[${index}]`
    const entry = record(value, ["floorId", "presentation"], path)
    if (typeof entry.floorId !== "string" || !entry.floorId || entry.floorId !== entry.floorId.trim()) fail(`${path}.floorId 必须是有效楼层 ID`)
    if (replacements.has(entry.floorId)) fail(`风格底图文件含重复楼层：${entry.floorId}`)
    const floor = floorById.get(entry.floorId)
    if (!floor) fail(`风格底图文件引用了未知楼层：${entry.floorId}`)
    if (!floor.floorplanDataUrl || !Number.isInteger(floor.imageWidth) || !Number.isInteger(floor.imageHeight) || floor.imageWidth <= 0 || floor.imageHeight <= 0 || floor.imageWidth > 100000 || floor.imageHeight > 100000) fail(`${floor.name} 需要完整工程底图与正整数尺寸才能导入风格校准`)
    imageSource(floor.floorplanDataUrl, `${floor.name} 工程底图`)
    const presentation = parsePointMapPresentation(entry.presentation, `${floor.name} 风格底图`)
    if (await fingerprintFloorplan(floor.floorplanDataUrl) !== presentation.sourceFingerprint) fail(`${floor.name} 的工程底图已变更或文件来源不匹配，请重新校准后导入`)
    replacements.set(entry.floorId, presentation)
  }
  // No part of the plan is changed until every requested floor passes validation.
  return {
    ...plan,
    floors: plan.floors?.map((floor) => replacements.has(floor.id) ? { ...floor, presentation: replacements.get(floor.id)! } : floor),
    updatedAt: new Date().toISOString(),
  }
}

function transformPoint([a, b, c, d, e, f]: PresentationAffineMatrix, point: PointMapPosition): PointMapPosition {
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} 必须是对象`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !(key in record))) fail(`${path} 字段不完整或包含不支持的字段`)
  return record
}

function finite(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${path} 必须是 ${min} 到 ${max} 之间的有限数字`)
  return value
}

function position(value: unknown, path: string, min: number, max: number): PointMapPosition {
  const input = record(value, ["x", "y"], path)
  return { x: finite(input.x, `${path}.x`, min, max), y: finite(input.y, `${path}.y`, min, max) }
}

function imageSource(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 30 * 1024 * 1024) fail(`${path} 必须是 PNG、JPEG、WebP 的 base64 图片`)
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) fail(`${path} 仅支持 PNG、JPEG、WebP 的 base64 图片`)
  let header: string
  try { header = atob(match[2].slice(0, 32)) } catch { return fail(`${path} 图片编码无效`) }
  const bytes = Array.from(header, (character) => character.charCodeAt(0))
  const valid = match[1] === "png" ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
    : match[1] === "webp" ? header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!valid) fail(`${path} 图片内容与格式不匹配`)
  return value
}

function fail(message: string): never { throw new PointMapFormatError(message) }
