import { pointMapImageSize, POINT_MAP_EXPORT_SYMBOL_SIZE } from "./point-map-image-size.mjs"
import { findPointIconById } from "./point-icons"
import type { PointMapNode, PointMapPlan, PointMapScene } from "./point-map-plan"
import { normalizeDesignPlan } from "./point-map-design"
import { specValueLabel } from "./device-spec-labels"
import { findDeviceType, type DeviceSpecs } from "./device-types"
import { resolvePointMapBackground } from "./point-map-presentation"
import { layoutPointMapMarkers } from "./point-map-marker-layout"
import { findProductImageBounds, stripProductImageMatte, type ProductImageBounds } from "./product-image-framing"
import { pointMapMarkerLabel } from "./point-map-labels"
import type { ProductVisualAsset } from "./product-visual-assets"

export type PointMapRenderOptions = {
  /** Customer outputs use a calibrated clean style base when one is saved. */
  background?: "engineering" | "presentation"
  title?: string
  /** Export only the floorplan and placed device symbols, without the report sections. */
  pointsOnly?: boolean
  /** Wrap each symbol in a category-colored circle and use the linked product image when available. */
  productCircles?: boolean
  products?: readonly PointMapRenderProduct[]
  /** Optional non-persistent product mapping, used when a saved quote still carries pointIds. */
  productIdByPointId?: ReadonlyMap<string, string>
  /** Customer PDF exports must not silently substitute an icon for a failed product photo. */
  strictProductImages?: boolean
}

export type PointMapRenderProduct = {
  id: string
  image?: string | null
  visualAsset?: ProductVisualAsset | null
}

/** All geometry uses output-image percentages, not engineering coordinates. */
export type PointMapRenderGeometry = {
  width: number
  height: number
  image: { x: number; y: number; width: number; height: number }
  markers: Array<{
    pointId: string
    label: string
    anchor: { x: number; y: number }
    marker: { x: number; y: number; radiusX: number; radiusY: number }
    labelRect: { x: number; y: number; width: number; height: number }
    labelBase: { x: number; y: number }
  }>
}
const renderGeometry = new WeakMap<HTMLCanvasElement, PointMapRenderGeometry>()
export function getPointMapRenderGeometry(canvas: HTMLCanvasElement) { return renderGeometry.get(canvas) }

const pointStatusNames = { pending: "待定位", planned: "规划中", confirmed: "已确认", changed: "需复核" } as const
const pointStatusColors = { pending: "#94a3b8", planned: "#64748b", confirmed: "#047857", changed: "#d97706" } as const

export type PointMapRenderLayout = {
  width: number
  height: number
  image: { left: number; top: number; width: number; height: number }
  markers: Array<{ point: PointMapNode; label: string; x: number; y: number }>
  listedPoints: Array<{ point: PointMapNode; label: string }>
  scenes: Array<PointMapScene & { labels: string[] }>
  sceneColumns: number
  sceneCardWidth: number
  groupTop: number
  sceneTop: number
  groupCards: Array<{ left: number; top: number; height: number }>
  sceneCards: Array<{ left: number; top: number; height: number }>
  pending: number
}

/** The image rectangle is the shared reference for display, drag and export. */
export function buildPointMapRenderLayout(
  input: PointMapPlan,
  floorId: string,
  imageSize: { width: number; height: number },
  options: Pick<PointMapRenderOptions, "pointsOnly" | "productCircles"> & { transformPoint?: (point: { x: number; y: number }) => { x: number; y: number } } = {},
): PointMapRenderLayout {
  if (!Number.isFinite(imageSize.width) || !Number.isFinite(imageSize.height) || imageSize.width <= 0 || imageSize.height <= 0) {
    throw new Error("底图尺寸无效，无法出图。")
  }
  const plan = normalizeDesignPlan(input)
  if (!plan.floors?.some((floor) => floor.id === floorId)) throw new Error("未找到需要出图的楼层。")
  const outputSize = pointMapImageSize(imageSize.width, imageSize.height)
  const pointsOnly = options.pointsOnly === true
  const margin = pointsOnly && options.productCircles ? Math.round(Math.max(80, Math.min(160, outputSize.width * .07))) : 24
  const image = {
    left: pointsOnly ? margin : 48,
    top: pointsOnly ? margin : 128,
    width: Math.round(outputSize.width),
    height: Math.round(outputSize.height),
  }
  const floorPoints = plan.points.filter((point) => point.floorId === floorId)
  const listedPoints = floorPoints.map((point) => ({ point, label: point.code || `P${String(plan.points.indexOf(point) + 1).padStart(3, "0")}` }))
  const markers = floorPoints.filter((point) => point.placed).map((point) => {
    const position = options.transformPoint?.(point) ?? point
    return {
    point,
    label: point.code || `P${String(plan.points.indexOf(point) + 1).padStart(3, "0")}`,
    x: image.left + (position.x / 100) * image.width,
    y: image.top + (position.y / 100) * image.height,
  } })
  const labelsById = new Map(markers.map((marker) => [marker.point.id, marker.label]))
  const scenes = (plan.scenes ?? []).filter((scene) => scene.pointIds.some((id) => labelsById.has(id))).map((scene) => ({
    ...scene,
    labels: scene.pointIds.flatMap((id) => labelsById.has(id) ? [labelsById.get(id)!] : []),
  }))
  const width = pointsOnly ? image.width + margin * 2 : Math.max(1100, image.width + 96)
  const sceneColumns = width >= 1800 ? 3 : 2
  const sceneCardWidth = (width - 96 - (sceneColumns - 1) * 24) / sceneColumns
  const groupTop = pointsOnly ? image.top + image.height : image.top + image.height + 110
  const groupLayout = arrangeCards(pointsOnly ? [] : listedPoints.map((entry) =>
    textBlockHeight(pointCardTitle(entry.point, entry.label), sceneCardWidth - 46, 20, 25) +
    pointDetailLines(entry.point).reduce((height, line) => height + textBlockHeight(line, sceneCardWidth - 16, 18, 23), 0) + 24,
  ), sceneColumns, sceneCardWidth, groupTop)
  const sceneTop = pointsOnly ? groupTop : groupLayout.bottom + 70
  const sceneLayout = arrangeCards(pointsOnly ? [] : scenes.map((scene) =>
    textBlockHeight(`${scene.name} · ${scene.status === "confirmed" ? "已确认" : "待确认"}`, sceneCardWidth - 32, 23, 29) +
    textBlockHeight(`触发：${scene.trigger || "待确认"}`, sceneCardWidth - 32, 19, 25) +
    textBlockHeight(scene.description || "动作待确认", sceneCardWidth - 32, 19, 25) +
    textBlockHeight(`关联：${scene.labels.join("、")}`, sceneCardWidth - 32, 19, 25) + 70,
  ), sceneColumns, sceneCardWidth, sceneTop)
  const height = pointsOnly ? image.top + image.height + margin : sceneLayout.bottom + 64
  if (height > 16000 || width * height > 60_000_000) throw new Error("场景过多，请按楼层分开出图或减少当前楼层的场景说明。")
  return { width, height, image, markers, listedPoints, scenes, sceneColumns, sceneCardWidth, groupTop, sceneTop, groupCards: groupLayout.cards, sceneCards: sceneLayout.cards, pending: floorPoints.filter((point) => !point.placed).length }
}

export async function renderPointMapFloor(
  input: PointMapPlan,
  floorId: string,
  options: PointMapRenderOptions = {},
): Promise<HTMLCanvasElement> {
  const plan = normalizeDesignPlan(input)
  const floor = plan.floors?.find((item) => item.id === floorId)
  if (!floor?.floorplanDataUrl) throw new Error("请先为当前楼层上传底图。")
  const background = await resolvePointMapBackground(floor, options.background ?? "engineering")
  const image = await loadDrawingImage(background.src)
  if (background.kind === "presentation" && (image.naturalWidth !== background.width || image.naturalHeight !== background.height)) {
    throw new Error(`${floor.name} 的风格底图尺寸已变化，请重新校准后导出。`)
  }
  const layout = buildPointMapRenderLayout(plan, floorId, { width: image.naturalWidth, height: image.naturalHeight }, { ...options, transformPoint: background.transformPoint })
  const symbols = new Map((options.pointsOnly ? layout.markers : layout.listedPoints).map((marker) => {
    const icon = findPointIconById(marker.point.iconId)
    if (!icon) throw new Error(`点位 ${marker.label} 的设备图标无法识别，请重新选择后再导出。`)
    return [marker.point.id, icon] as const
  }))
  // Use the exact SVG assets shown in the workbench, generated from the CAD geometry.
  const symbolImages = new Map(await Promise.all(
    [...new Set([...symbols.values()].map((icon) => icon.icon))].map(async (src) =>
      [src, await loadDrawingImage(src, "设备图标无法读取，请刷新页面后重新导出。")] as const,
    ),
  ))
  const productImages = new Map<string, ProductImageAsset>()
  if (options.productCircles) {
    const floorProductIds = new Set(layout.markers.map(({ point }) => options.productIdByPointId?.get(point.id) || point.productId).filter(Boolean))
    const products = (options.products ?? []).filter((product) => floorProductIds.has(product.id))
    if (options.strictProductImages) {
      const withPhoto = new Set(products.filter((product) => product.image?.trim()).map((product) => product.id))
      const missing = layout.markers.filter(({ point }) => {
        const id = options.productIdByPointId?.get(point.id) || point.productId
        return id && !withPhoto.has(id)
      })
      if (missing.length) throw new Error(`点位 ${missing.map((marker) => marker.label).join("、")} 的商品图片尚未补齐，请补充后导出。`)
    }
    await Promise.all(products.flatMap((product) => {
      const src = product.image?.trim()
      if (!src) return []
      return [loadProductImage(src, product.visualAsset)
        .then((asset) => productImages.set(product.id, asset))
        .catch((error: unknown) => { if (options.strictProductImages) throw error })]
    }))
  }
  const canvas = document.createElement("canvas")
  const pixelRatio = options.productCircles ? Math.max(1, Math.min(3, 3200 / layout.width, 16000 / layout.height, Math.sqrt(60_000_000 / (layout.width * layout.height)))) : 1
  canvas.width = Math.round(layout.width * pixelRatio)
  canvas.height = Math.round(layout.height * pixelRatio)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("当前浏览器无法生成图纸。")
  if (pixelRatio !== 1) ctx.scale(pixelRatio, pixelRatio)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  if (!options.pointsOnly) {
    ctx.fillStyle = "#0f172a"
    ctx.font = "bold 34px sans-serif"
    ctx.fillText(options.title || `${floor.name} · 智能家居点位与场景`, 48, 30)
    ctx.font = "20px sans-serif"
    ctx.fillStyle = "#475569"
    const confirmed = layout.markers.filter((marker) => marker.point.status === "confirmed").length
    const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(plan.updatedAt))
    ctx.fillText(`点位 ${layout.markers.length} · 已确认 ${confirmed} · 待定位 ${layout.pending} · ${date}`, 48, 82)
  }
  ctx.drawImage(image, layout.image.left, layout.image.top, layout.image.width, layout.image.height)

  const symbolSize = POINT_MAP_EXPORT_SYMBOL_SIZE
  const circleRadius = Math.max(36, Math.min(72, layout.image.width * .03))
  ctx.font = "600 16px sans-serif"
  const placements = options.productCircles ? layoutPointMapMarkers({
    markers: layout.markers.map((marker) => {
      const label = pointMapMarkerLabel(marker.point)
      const display = marker.point.display
      const x = marker.x + (display?.markerOffset.x ?? 0) / 100 * layout.image.width
      const y = marker.y + (display?.markerOffset.y ?? 0) / 100 * layout.image.height
      return { id: marker.point.id, x: marker.x, y: marker.y, label, ...(display ? { display: {
        x, y,
        labelX: x - (ctx.measureText(label).width + 8) / 2 + display.labelOffset.x / 100 * layout.image.width,
        labelY: y + circleRadius + Math.max(3, circleRadius * .12) + display.labelOffset.y / 100 * layout.image.height,
      } } : {}) }
    }),
    bounds: { left: 8, top: options.pointsOnly ? 8 : layout.image.top - 8, width: layout.width - 16, height: options.pointsOnly ? layout.height - 16 : layout.image.height + 16 },
    radius: circleRadius,
    labelHeight: 20,
    labelWidth: (label) => ctx.measureText(label).width + 8,
  }) : []
  const placementById = new Map(placements.map((placement) => [placement.id, placement]))
  renderGeometry.set(canvas, {
    width: canvas.width, height: canvas.height,
    image: { x: layout.image.left / layout.width * 100, y: layout.image.top / layout.height * 100, width: layout.image.width / layout.width * 100, height: layout.image.height / layout.height * 100 },
    markers: placements.map((placement) => ({
      pointId: placement.id,
      label: pointMapMarkerLabel(layout.markers.find((marker) => marker.point.id === placement.id)!.point),
      anchor: { x: placement.anchorX / layout.width * 100, y: placement.anchorY / layout.height * 100 },
      marker: { x: placement.x / layout.width * 100, y: placement.y / layout.height * 100, radiusX: circleRadius / layout.width * 100, radiusY: circleRadius / layout.height * 100 },
      labelRect: { x: placement.labelX / layout.width * 100, y: placement.labelY / layout.height * 100, width: placement.labelWidth / layout.width * 100, height: placement.labelHeight / layout.height * 100 },
      labelBase: { x: (placement.x - placement.labelWidth / 2) / layout.width * 100, y: (placement.y + circleRadius + Math.max(3, circleRadius * .12)) / layout.height * 100 },
    })),
  })
  // Leaders sit behind photos and labels; the installation anchors never change.
  for (const placement of placements) {
    const distance = Math.hypot(placement.x - placement.anchorX, placement.y - placement.anchorY)
    if (distance <= circleRadius + 3) continue
    ctx.beginPath()
    ctx.moveTo(placement.anchorX, placement.anchorY)
    ctx.lineTo(placement.x + (placement.anchorX - placement.x) * circleRadius / distance, placement.y + (placement.anchorY - placement.y) * circleRadius / distance)
    // A leader should explain a moved marker without becoming another drawing
    // element competing with the floor plan.  Keep it slightly lighter than
    // the product circle border and use a small anchor dot.
    ctx.strokeStyle = "rgba(71, 85, 105, 0.46)"
    ctx.lineWidth = 0.9
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(placement.anchorX, placement.anchorY, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(71, 85, 105, 0.62)"
    ctx.fill()
  }
  for (const marker of layout.markers) {
    const icon = symbols.get(marker.point.id)!
    const productId = options.productIdByPointId?.get(marker.point.id) || marker.point.productId
    const productAsset = options.productCircles
      ? productImages.get(productId)
      : undefined
    const productImage = productAsset?.source
    if (options.productCircles) {
      const placement = placementById.get(marker.point.id)!
      const markerLabel = pointMapMarkerLabel(marker.point)
      drawCircularMarker(ctx, productImage ?? symbolImages.get(icon.icon)!, placement.x, placement.y, circleRadius, markerVisualColor(marker.point), productAsset?.frame, productAsset?.scale)
      ctx.beginPath()
      ctx.arc(placement.x + circleRadius * .71, placement.y + circleRadius * .71, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = pointStatusColors[marker.point.status]
      ctx.fill()
      ctx.strokeStyle = "rgba(255,255,255,0.82)"
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = "rgba(255,255,255,0.96)"
      ctx.fillRect(placement.labelX, placement.labelY, placement.labelWidth, placement.labelHeight)
      ctx.font = "600 16px sans-serif"
      ctx.fillStyle = "#1e293b"
      ctx.fillText(markerLabel, placement.labelX + 4, placement.labelY + 2)
      continue
    } else {
      ctx.drawImage(symbolImages.get(icon.icon)!, marker.x - symbolSize / 2, marker.y - symbolSize / 2, symbolSize, symbolSize)
    }
    const statusWidth = symbolSize * 8 / 22
    ctx.fillStyle = pointStatusColors[marker.point.status]
    ctx.fillRect(marker.x - statusWidth / 2, marker.y + symbolSize / 2 + symbolSize * 5 / 22, statusWidth, Math.max(2, symbolSize * 2 / 22))
    ctx.font = "600 18px sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    const text = marker.label.slice(0, 32)
    const labelWidth = ctx.measureText(text).width
    const offset = symbolSize / 2 + 6
    const labelX = marker.x + labelWidth + offset > layout.image.left + layout.image.width ? marker.x - labelWidth - offset : marker.x + offset
    ctx.strokeStyle = "rgba(255,255,255,0.94)"
    ctx.lineWidth = 3
    ctx.lineJoin = "round"
    ctx.strokeText(text, labelX, marker.y - 9)
    ctx.fillStyle = "#334155"
    ctx.fillText(text, labelX, marker.y - 9)
  }

  if (options.pointsOnly) return canvas

  const legendY = layout.image.top + layout.image.height + 32
  ctx.font = "20px sans-serif"
  ctx.fillStyle = "#475569"
  ctx.fillText(`图形库 v${plan.symbolVersion} · 图标与工作台、CAD 同源；朝向按备注，橙色短标需复核。`, 48, legendY)
  ctx.font = "bold 25px sans-serif"
  ctx.fillStyle = "#0f172a"
  ctx.fillText("点位与设计说明", 48, layout.groupTop - 38)
  layout.listedPoints.forEach((marker, index) => {
    const { left: x, top: y } = layout.groupCards[index]
    const icon = symbols.get(marker.point.id)!
    ctx.drawImage(symbolImages.get(icon.icon)!, x, y + 1, 22, 22)
    ctx.font = "bold 20px sans-serif"
    ctx.fillStyle = "#0f172a"
    const afterTitle = drawWrappedText(ctx, pointCardTitle(marker.point, marker.label), x + 30, y, layout.sceneCardWidth - 46, 25)
    ctx.font = "18px sans-serif"
    ctx.fillStyle = "#475569"
    let detailY = afterTitle + 4
    for (const line of pointDetailLines(marker.point))
      detailY = drawWrappedText(ctx, line, x, detailY, layout.sceneCardWidth - 16, 23)
  })
  ctx.font = "bold 25px sans-serif"
  ctx.fillStyle = "#0f172a"
  ctx.fillText("场景说明", 48, layout.sceneTop - 38)
  if (!layout.scenes.length) {
    ctx.font = "20px sans-serif"
    ctx.fillStyle = "#64748b"
    ctx.fillText("当前楼层暂无关联场景。", 48, layout.sceneTop + 8)
  }
  layout.scenes.forEach((scene, index) => {
    const { left: x, top: y, height } = layout.sceneCards[index]
    ctx.fillStyle = "#f8fafc"
    ctx.fillRect(x, y, layout.sceneCardWidth, height)
    ctx.strokeStyle = "#cbd5e1"
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, layout.sceneCardWidth, height)
    ctx.fillStyle = "#0f172a"
    ctx.font = "bold 23px sans-serif"
    let cursor = drawWrappedText(ctx, `${scene.name} · ${scene.status === "confirmed" ? "已确认" : "待确认"}`, x + 16, y + 16, layout.sceneCardWidth - 32, 29) + 12
    ctx.font = "19px sans-serif"
    ctx.fillStyle = "#475569"
    cursor = drawWrappedText(ctx, `触发：${scene.trigger || "待确认"}`, x + 16, cursor, layout.sceneCardWidth - 32, 25) + 12
    cursor = drawWrappedText(ctx, scene.description || "动作待确认", x + 16, cursor, layout.sceneCardWidth - 32, 25) + 12
    ctx.fillStyle = "#0f766e"
    drawWrappedText(ctx, `关联：${scene.labels.join("、")}`, x + 16, cursor, layout.sceneCardWidth - 32, 25)
  })
  return canvas
}

type ProductImageAsset = {
  source: HTMLImageElement | HTMLCanvasElement
  frame: ProductImageBounds
  scale?: number
}

// Each document owns a bounded decode/processing cache. Test doubles and new
// browser documents cannot reuse decoded images from another rendering realm.
const productAssetCaches = new WeakMap<Document, Map<string, Promise<ProductImageAsset>>>()
async function loadProductImage(src: string, visual: ProductVisualAsset | null | undefined): Promise<ProductImageAsset> {
  const crop = visual?.crop
  const scale = visual?.scale ?? 1
  if (!Number.isFinite(scale) || scale < .5 || scale > 2 || (crop && (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9))) throw new Error("商品展示图裁切或主体大小无效，请检查商品展示图库后重试。")
  let cache = productAssetCaches.get(document)
  if (!cache) { cache = new Map(); productAssetCaches.set(document, cache) }
  // Frozen deliveries can carry multi-megabyte data URLs. Keep only a digest
  // as the cache key instead of retaining a second base64 copy per crop.
  const sourceKey = src.length > 4096
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src))), (byte) => byte.toString(16).padStart(2, "0")).join("")
    : src
  const key = JSON.stringify([sourceKey, visual?.crop ?? null, visual?.scale ?? 1, visual?.revision ?? null])
  const cached = cache.get(key)
  if (cached) { cache.delete(key); cache.set(key, cached); return cached }
  const promise = loadDrawingImage(src, "商品图片无法读取，请检查产品库图片后重试。").then((image) => {
    const asset = prepareProductImage(image)
    const crop = visual?.crop
    if (crop) {
      const width = "naturalWidth" in asset.source ? asset.source.naturalWidth : asset.source.width
      const height = "naturalHeight" in asset.source ? asset.source.naturalHeight : asset.source.height
      asset.frame = { x: crop.x * width, y: crop.y * height, width: crop.width * width, height: crop.height * height }
    }
    return { ...asset, scale: visual?.scale ?? 1 }
  }).catch((error) => { cache!.delete(key); throw error })
  cache.set(key, promise)
  while (cache.size > 48) cache.delete(cache.keys().next().value!)
  return promise
}

function prepareProductImage(image: HTMLImageElement): ProductImageAsset {
  let frame = productImageFrame(image)
  // A readback is best-effort: remote images or test doubles may not expose
  // pixels. In that case the original image and conservative frame remain.
  try {
    const sample = document.createElement("canvas")
    const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    sample.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    sample.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = sample.getContext("2d", { willReadFrequently: true })
    if (!context?.getImageData || !context.putImageData) return { source: image, frame }
    context.drawImage(image, 0, 0, sample.width, sample.height)
    const pixels = context.getImageData(0, 0, sample.width, sample.height)
    const normalized = stripProductImageMatte(pixels)
    if (normalized === pixels) return { source: sample, frame: { x: frame.x * ratio, y: frame.y * ratio, width: frame.width * ratio, height: frame.height * ratio } }
    // putImageData requires a native ImageData instance, not a typed plain
    // object. Copy the processed bytes into the instance returned by canvas.
    pixels.data.set(normalized.data)
    context.putImageData(pixels, 0, 0)
    const sampleFrame = findProductImageBounds(normalized)
    // The processed canvas is deliberately small; drawing it avoids carrying
    // white JPEG mattes into the circle while retaining the source aspect.
    frame = sampleFrame
    return { source: sample, frame }
  } catch {
    return { source: image, frame }
  }
}

function drawCircularMarker(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  colors: { fill: string; stroke: string },
  frame: ProductImageBounds = { x: 0, y: 0, width: "naturalWidth" in image ? image.naturalWidth : image.width, height: "naturalHeight" in image ? image.naturalHeight : image.height },
  scale = 1,
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = colors.fill
  // Keep the marker readable on a white CAD base without creating a heavy
  // halo.  Product photos carry most of the visual weight; the category color
  // is intentionally a quiet backing layer.
  ctx.shadowColor = "rgba(15, 23, 42, 0.12)"
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1
  ctx.fill()
  ctx.shadowColor = "transparent"
  ctx.clip()
  // The circle already clips the four corners, so fitting by the diagonal
  // makes square product photos needlessly small. Fit by the longest edge
  // instead; the subject fills the circle while long/flat products retain
  // their aspect ratio and the circular mask trims only the corners.
  const imageScale = (radius * 1.76 * scale) / Math.max(frame.width, frame.height)
  const imageWidth = frame.width * imageScale
  const imageHeight = frame.height * imageScale
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, x - imageWidth / 2, y - imageHeight / 2, imageWidth, imageHeight)
  ctx.restore()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = colors.stroke
  // Keep a fine muted edge: product photos and the plan carry the detail.
  ctx.lineWidth = 0.8
  ctx.stroke()
}

const productImageFrames = new WeakMap<HTMLImageElement, ProductImageBounds>()

/** Only trim proven empty margins for display; product assets and pale device edges stay intact. */
function productImageFrame(image: HTMLImageElement): ProductImageBounds {
  const cached = productImageFrames.get(image)
  if (cached) return cached
  const full = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
  let frame = full
  try {
    const sample = document.createElement("canvas")
    const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    sample.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    sample.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = sample.getContext("2d", { willReadFrequently: true })
    if (context?.getImageData) {
      context.drawImage(image, 0, 0, sample.width, sample.height)
      const bounds = findProductImageBounds(context.getImageData(0, 0, sample.width, sample.height))
      const x = Math.floor(bounds.x / sample.width * image.naturalWidth)
      const y = Math.floor(bounds.y / sample.height * image.naturalHeight)
      frame = { x, y, width: Math.min(image.naturalWidth, Math.ceil((bounds.x + bounds.width) / sample.width * image.naturalWidth)) - x, height: Math.min(image.naturalHeight, Math.ceil((bounds.y + bounds.height) / sample.height * image.naturalHeight)) - y }
    }
  } catch {
    // Cross-origin photos can still render in their original frame when pixel reads are unavailable.
  }
  productImageFrames.set(image, frame)
  return frame
}

function markerVisualColor(point: PointMapNode) {
  if (["camera", "doorbell"].includes(point.iconId)) return { fill: "#fff4f3", stroke: "rgba(185,91,86,0.32)" }
  if (["ap", "network-controller", "poe-switch", "gateway", "mesh-node", "data-point"].includes(point.iconId)) return { fill: "#f2f6fc", stroke: "rgba(80,116,168,0.32)" }
  if (["curtain"].includes(point.iconId)) return { fill: "#f7f3fc", stroke: "rgba(135,99,167,0.32)" }
  if (["panel-small", "panel-large"].includes(point.iconId)) return { fill: "#f2f6fc", stroke: "rgba(80,116,168,0.32)" }
  return { fill: "#f1f7f5", stroke: "rgba(71,131,113,0.32)" }
}

function pointCardTitle(point: PointMapNode, label: string) {
  return `${label} · ${point.room} · ${point.placed ? pointStatusNames[point.status] : "待定位"}`
}

export function pointDetailLines(point: PointMapNode): string[] {
  const lines = [`设备：${point.name}`]
  const type = findDeviceType(point.deviceTypeId)
  lines.push(`类型：${type?.name ?? "待确认（旧占位图标不代表已核规格）"}`)
  lines.push(`选用：${{ proposed: "待评估，不计采购", selected: "正式选用，采购前需核验", reserve: "预留，不计采购" }[point.usage ?? "proposed"]}`)
  if (point.requirements && Object.keys(point.requirements).length) lines.push(`要求：${describeSpecs(point.deviceTypeId, point.requirements)}`)
  if (point.selection) {
    const selection = point.selection
    lines.push(`选型快照：${selection.name} · ${selection.manufacturerModel || selection.sku} · 产品版本 ${selection.mappingRevision}`)
    lines.push(`保存规格：${describeSpecs(selection.deviceTypeId, selection.specs) || "未记录"}`)
    lines.push(`核验时间：${selection.verifiedAt.slice(0, 10)}；采购前复核最新资料`)
  } else lines.push(point.productId ? "型号：原关联尚无已核选型快照，待重新选型" : "型号：待选型；布局可独立确认")
  for (const material of point.materials ?? []) {
    const role = { track: "轨道", accessory: "配件", service: "服务" }[material.role]
    lines.push(`配套${role}：${material.quantity == null ? "数量待测" : `${material.quantity} ${material.unit || "单位待核"}`} · ${material.included ? "套装已含，不重复计价" : material.required ? "必配" : "选配"}${!material.included && !material.productId ? " · 型号待选" : ""}`)
    if (material.selection) lines.push(`配套快照：${material.selection.name} · ${material.selection.manufacturerModel || material.selection.sku} · 产品版本 ${material.selection.mappingRevision}`)
  }
  if (point.controlTargets?.length) lines.push(`控制对象：${point.controlTargets.join("、")}`)
  else if (["switch-1", "switch-2", "switch-3", "switch-4", "dimmer-switch"].includes(point.iconId)) lines.push("控制灯组待确认")
  if (point.note.trim()) lines.push(`备注：${point.note}`)
  if (point.reviewReason?.trim()) lines.push(`复核：${point.reviewReason}`)
  return lines
}

function describeSpecs(typeId: string | undefined, specs: DeviceSpecs): string {
  const type = findDeviceType(typeId)

  return Object.entries(specs).map(([key, value]) => {
    const field = type?.specs.find((item) => item.key === key)
    const shown = specValueLabel(value)
    return `${field?.name ?? key} ${shown}${field?.unit ?? ""}`
  }).join("、")
}

function loadDrawingImage(src: string, errorMessage = "底图无法读取，请重新上传清晰的图片。"): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    if (/^https?:\/\//i.test(src)) image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(errorMessage))
    image.src = src
  })
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number) {
  const lines: string[] = []
  let line = ""
  for (const char of text) {
    if (char === "\n" || (line && ctx.measureText(line + char).width > width)) {
      lines.push(line)
      line = char === "\n" ? "" : char
    } else line += char
  }
  if (line) lines.push(line)
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight))
  return y + Math.max(1, lines.length) * lineHeight
}

// A conservative one-em width keeps the allocation larger than rendered Chinese/Latin text.
function textBlockHeight(text: string, width: number, fontSize: number, lineHeight: number) {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 1.15)))
  return text.split("\n").reduce((lines, paragraph) => lines + Math.max(1, Math.ceil(paragraph.length / perLine)), 0) * lineHeight
}

function arrangeCards(heights: number[], columns: number, width: number, start: number) {
  const cards: Array<{ left: number; top: number; height: number }> = []
  let top = start
  for (let index = 0; index < heights.length; index += columns) {
    const rowHeight = Math.max(...heights.slice(index, index + columns))
    for (let col = 0; col < Math.min(columns, heights.length - index); col++) cards.push({ left: 48 + col * (width + 24), top, height: rowHeight })
    top += rowHeight + 24
  }
  return { cards, bottom: heights.length ? top : start + 70 }
}
