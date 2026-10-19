import { afterEach, describe, expect, it, vi } from "vitest"
import { buildPointMapRenderLayout, getPointMapRenderGeometry, renderPointMapFloor } from "../lib/point-map-render"
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan"
import { pointIconDefinitions } from "../lib/point-icons"
import { createHash } from "node:crypto"

function design(): PointMapPlan {
  return {
    ...emptyPointMapPlan("project-test", () => "2026-10-14T00:00:00.000Z"),
    schemaVersion: 2,
    floors: [
      { id: "first", name: "一层", floorplanName: "a.png", floorplanDataUrl: "", imageWidth: 2000, imageHeight: 1000 },
      { id: "second", name: "二层", floorplanName: "b.png", floorplanDataUrl: "", imageWidth: 1000, imageHeight: 2000 },
    ],
    activeFloorId: "first",
    points: [
      { id: "a", floorId: "first", code: "K01", name: "入口", room: "玄关", iconId: "switch-1", x: 25, y: 75, status: "planned", placed: true, productId: "", note: "" },
      { id: "b", floorId: "second", code: "K02", name: "楼梯", room: "楼梯", iconId: "switch-1", x: 50, y: 50, status: "planned", placed: true, productId: "", note: "" },
      { id: "c", floorId: "first", code: "K03", name: "待定位", room: "客厅", iconId: "switch-1", x: 50, y: 50, status: "pending", placed: false, productId: "", note: "" },
    ],
    scenes: [
      { id: "s1", name: "回家", trigger: "按键", description: "开启玄关灯", pointIds: ["a", "b"], status: "proposed" },
      { id: "s2", name: "楼梯", trigger: "按键", description: "开启楼梯灯", pointIds: ["b"], status: "proposed" },
    ],
  }
}

describe("point map render layout", () => {
  it("positions markers relative to the actual drawing and isolates floor scene references", () => {
    const layout = buildPointMapRenderLayout(design(), "first", { width: 2000, height: 1000 })
    expect(layout.markers).toHaveLength(1)
    expect(layout.markers[0]).toMatchObject({ label: "K01", x: 798, y: 1253 })
    expect(layout.scenes.map((scene) => scene.labels)).toEqual([["K01"]])
    expect(layout.pending).toBe(1)
  })
  it("renders the user's final moved coordinates at a different image aspect ratio", () => {
    const plan = design()
    plan.points[0].x = 80
    plan.points[0].y = 10
    const layout = buildPointMapRenderLayout(plan, "first", { width: 1000, height: 2000 })
    expect(layout.markers[0]).toMatchObject({ x: 1248, y: 428 })
  })
  it("rejects invalid image dimensions and missing floors", () => {
    expect(() => buildPointMapRenderLayout(design(), "first", { width: Infinity, height: 10 })).toThrow()
    expect(() => buildPointMapRenderLayout(design(), "absent", { width: 100, height: 100 })).toThrow()
  })
  it("expands scene cards for long descriptions instead of dropping scene actions", () => {
    const plan = design()
    const short = buildPointMapRenderLayout(plan, "first", { width: 1000, height: 800 })
    plan.scenes![0].description = "开启入口灯组并保持手动操作。".repeat(40)
    const long = buildPointMapRenderLayout(plan, "first", { width: 1000, height: 800 })
    expect(long.sceneCards[0].height).toBeGreaterThan(short.sceneCards[0].height)
    expect(long.scenes[0].description).toBe(plan.scenes![0].description)
  })
  it("uses the workspace numbering fallback for migrated points without a code", () => {
    const plan = design()
    plan.points[0].code = ""
    expect(buildPointMapRenderLayout(plan, "first", { width: 1000, height: 800 }).markers[0].label).toBe("P001")
  })
  it("can build a clean points-only layout without report sections", () => {
    const layout = buildPointMapRenderLayout(design(), "first", { width: 2000, height: 1000 }, { pointsOnly: true })
    expect(layout.image).toMatchObject({ left: 24, top: 24, width: 3000, height: 1500 })
    expect(layout.groupCards).toHaveLength(0)
    expect(layout.sceneCards).toHaveLength(0)
    expect(layout.height).toBe(1548)
  })
  it("lists pending infrastructure without inventing a position on the map", () => {
    const plan = design()
    plan.points[2] = { ...plan.points[2], iconId: "network-controller", name: "无线 AC 控制器，设备柜待核对", note: "供电、散热和机柜空间待确认" }
    const layout = buildPointMapRenderLayout(plan, "first", { width: 2000, height: 1000 })
    expect(layout.markers.map((item) => item.point.id)).toEqual(["a"])
    expect(layout.listedPoints.map((item) => item.point.id)).toEqual(["a", "c"])
    expect(layout.groupCards).toHaveLength(2)
    expect(layout.pending).toBe(1)
  })
  it("allocates enough space for camera direction and installation review notes", () => {
    const plan = design()
    const short = buildPointMapRenderLayout(plan, "first", { width: 1000, height: 800 })
    plan.points[0].iconId = "camera"
    plan.points[0].note = "室外摄像头朝向图纸左侧，避免拍向室内；安装高度和网线防水引入待核对。".repeat(6)
    plan.points[0].reviewReason = "无庭院边界及立面资料，需现场核对遮挡与覆盖。"
    const detailed = buildPointMapRenderLayout(plan, "first", { width: 1000, height: 800 })
    expect(detailed.groupCards[0].height).toBeGreaterThan(short.groupCards[0].height)
    expect(detailed.sceneTop).toBeGreaterThan(short.sceneTop)
  })
})

describe("point map device symbol export", () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockDrawing(failingAsset?: string) {
    const loaded: string[] = []
    class DrawingImage {
      naturalWidth = 2000
      naturalHeight = 1000
      onload?: () => void
      onerror?: () => void
      private source = ""
      set src(value: string) {
        this.source = value
        loaded.push(value)
        queueMicrotask(() => value === failingAsset ? this.onerror?.() : this.onload?.())
      }
      get src() { return this.source }
    }
    const ctx = {
      fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      fillText: vi.fn(), strokeText: vi.fn(), arc: vi.fn(), scale: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 10 }),
    }
    const canvas = { width: 0, height: 0, getContext: () => ctx }
    vi.stubGlobal("Image", DrawingImage)
    vi.stubGlobal("document", { createElement: () => canvas })
    return { loaded, ctx, canvas }
  }

  function drawablePlan() {
    const plan = design()
    plan.floors![0].floorplanDataUrl = "data:image/png;base64,iVBORw0KGgo="
    return plan
  }

  it("uses the saved clean style base and its calibrated coordinates for customer exports", async () => {
    const { ctx, loaded } = mockDrawing()
    const plan = drawablePlan()
    const engineering = plan.floors![0].floorplanDataUrl
    const style = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    Object.assign(plan.floors![0], { presentation: {
      name: "浅色材质彩平", imageDataUrl: style, imageWidth: 2000, imageHeight: 1000,
      sourceFingerprint: createHash("sha256").update(engineering).digest("hex"),
      matrix: [1, 0, 0, 1, 1, 2],
      anchors: [
        { source: { x: 0, y: 0 }, target: { x: 1, y: 2 } },
        { source: { x: 100, y: 0 }, target: { x: 101, y: 2 } },
        { source: { x: 0, y: 100 }, target: { x: 1, y: 102 } },
      ],
    } })
    await renderPointMapFloor(plan, "first", { pointsOnly: true, background: "presentation" })
    expect(loaded).toContain(style)
    expect(loaded).not.toContain(engineering)
    const call = ctx.drawImage.mock.calls.find(([image]) => image.src === pointIconDefinitions.find((icon) => icon.id === "switch-1")!.icon)!
    expect(call[1] + call[3] / 2).toBeCloseTo(24 + 3000 * .26)
    expect(call[2] + call[4] / 2).toBeCloseTo(24 + 1500 * .77)
    expect(plan.points[0]).toMatchObject({ x: 25, y: 75 })
    expect(plan.floors![0].floorplanDataUrl).toBe(engineering)
  })

  it("draws the real workbench assets for every device type, without letter substitutes or circular backplates", async () => {
    const { ctx, loaded, canvas } = mockDrawing()
    const plan = drawablePlan()
    plan.points = pointIconDefinitions.map((icon, index) => ({
      ...plan.points[0], id: `device-${index}`, iconId: icon.id, code: `P${index + 1}`,
      x: 10 + index * 2, y: 50,
    }))
    plan.scenes = []
    expect(await renderPointMapFloor(plan, "first")).toBe(canvas)
    const uniqueAssets = [...new Set(pointIconDefinitions.map((icon) => icon.icon))].sort()
    expect(loaded.filter((src) => src.startsWith("/assets/"))).toEqual(expect.arrayContaining(uniqueAssets))
    expect(loaded.filter((src) => src.startsWith("/assets/"))).toHaveLength(uniqueAssets.length)
    const symbols = ctx.drawImage.mock.calls.filter(([image]) => image.src.startsWith("/assets/"))
    expect(symbols).toHaveLength(pointIconDefinitions.length * 2)
    expect(symbols.slice(0, pointIconDefinitions.length).map(([image]) => image.src)).toEqual(pointIconDefinitions.map((icon) => icon.icon))
    expect(ctx.arc).not.toHaveBeenCalled()
    const drawnText = ctx.fillText.mock.calls.map(([text]) => text)
    for (const icon of pointIconDefinitions) expect(drawnText).not.toContain(icon.code)
    expect(drawnText).toContain("P1")
  })

  it("keeps the edited image-percent anchor at the centre of the exported device icon", async () => {
    const { ctx } = mockDrawing()
    const plan = drawablePlan()
    plan.points[0].x = 80
    plan.points[0].y = 10
    await renderPointMapFloor(plan, "first")
    const call = ctx.drawImage.mock.calls.find(([image]) => image.src === pointIconDefinitions.find((icon) => icon.id === "switch-1")!.icon)!
    const [, left, top, width, height] = call
    expect(left + width / 2).toBe(48 + 3000 * .8)
    expect(top + height / 2).toBe(128 + 1500 * .1)
  })

  it("exports points-only images without titles, legends, or point detail cards", async () => {
    const { ctx, canvas } = mockDrawing()
    await renderPointMapFloor(drawablePlan(), "first", { pointsOnly: true })
    const drawnText = ctx.fillText.mock.calls.map(([text]) => text).join("")
    expect(canvas.width).toBe(3048)
    expect(canvas.height).toBe(1548)
    expect(drawnText).toContain("K01")
    expect(drawnText).not.toContain("图形库 v1")
    expect(drawnText).not.toContain("点位与设计说明")
    expect(drawnText).not.toContain("智能家居点位与场景")
  })

  it("uses a linked product image inside a visible category circle", async () => {
    const { ctx, loaded } = mockDrawing()
    const plan = drawablePlan()
    plan.points[0].productId = "product-1"
    await renderPointMapFloor(plan, "first", {
      pointsOnly: true,
      productCircles: true,
      products: [{ id: "product-1", image: "/assets/products/sumi/sumi-h2u.png" }],
    })
    expect(loaded).toContain("/assets/products/sumi/sumi-h2u.png")
    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.clip).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    const photo = ctx.drawImage.mock.calls.find(([image]) => image.src === "/assets/products/sumi/sumi-h2u.png")!
    const [, , photoWidth, photoHeight] = photo.slice(-4)
    expect(photoWidth / photoHeight).toBeCloseTo(2)
    const radius = ctx.arc.mock.calls[0][2]
    expect(photoWidth / radius).toBeGreaterThan(1.73)
    expect(Math.hypot(photoWidth, photoHeight) / 2).toBeLessThan(radius)
  })

  it("exposes exact output geometry and honors presentation offsets without moving installation anchors", async () => {
    mockDrawing()
    const plan = drawablePlan()
    plan.points[0].display = { markerOffset: { x: 3, y: -1 }, labelOffset: { x: 0, y: 0 } }
    const canvas = await renderPointMapFloor(plan, "first", { pointsOnly: true, productCircles: true })
    const geometry = getPointMapRenderGeometry(canvas)!
    const point = geometry.markers[0]
    expect(point.pointId).toBe("a")
    expect(point.marker.x - point.anchor.x).toBeCloseTo(geometry.image.width * .03)
    expect(point.marker.y - point.anchor.y).toBeCloseTo(-geometry.image.height * .01)
    expect(point.labelRect.x).toBeCloseTo(point.labelBase.x)
    expect(point.labelRect.y).toBeCloseTo(point.labelBase.y)
    expect(geometry.width).toBe(canvas.width)
    expect(plan.points[0]).toMatchObject({ x: 25, y: 75 })
  })

  it("reuses product decoding across floors and reads crop/scale without overriding a frozen image", async () => {
    const { ctx, loaded } = mockDrawing()
    const plan = drawablePlan()
    plan.floors![1].floorplanDataUrl = plan.floors![0].floorplanDataUrl
    plan.points[0].productId = "photo"
    plan.points[1].productId = "photo"
    const visualAsset = { image: "/catalog-new.png", sourceImage: "/source.png", crop: { x: .1, y: .2, width: .5, height: .4 }, scale: 1.2, revision: 1, updatedAt: "now", reviewStatus: "series" as const }
    const options = { pointsOnly: true, productCircles: true, products: [{ id: "photo", image: "data:image/png;base64,frozen", visualAsset }] }
    await renderPointMapFloor(plan, "first", options)
    await renderPointMapFloor(plan, "second", options)
    expect(loaded.filter((src) => src === "data:image/png;base64,frozen")).toHaveLength(1)
    expect(loaded).not.toContain("/catalog-new.png")
    const photos = ctx.drawImage.mock.calls.filter(([image]) => image.src === "data:image/png;base64,frozen" && (image as unknown) !== undefined)
    expect(photos.some((call) => call[1] === 200 && call[2] === 200 && call[3] === 1000 && call[4] === 400)).toBe(true)
  })

  it("renders a nonempty processed photo with native ImageData dimensions and canvas writeback", async () => {
    // Browser ImageData dimensions are prototype getters, not enumerable
    // properties. A spread-based mock would hide the production failure.
    class NativeImageData {
      readonly data: Uint8ClampedArray
      #width: number
      #height: number
      constructor(width: number, height: number) {
        this.#width = width
        this.#height = height
        this.data = new Uint8ClampedArray(width * height * 4).fill(255)
        for (let y = 16; y < 32; y++) {
          for (let x = 16; x < 32; x++) {
            const offset = (y * width + x) * 4
            this.data.set([40, 50, 60, 255], offset)
          }
        }
      }
      get width() { return this.#width }
      get height() { return this.#height }
    }
    class DrawingImage {
      naturalWidth = 48
      naturalHeight = 48
      onload?: () => void
      private source = ""
      set src(value: string) {
        this.source = value
        queueMicrotask(() => this.onload?.())
      }
      get src() { return this.source }
    }
    const contexts: Array<{
      canvas: { width: number; height: number }
      drawImage: ReturnType<typeof vi.fn>
      putImageData: ReturnType<typeof vi.fn>
      committed: NativeImageData[]
    }> = []
    vi.stubGlobal("Image", DrawingImage)
    vi.stubGlobal("document", { createElement: () => {
      const committed: NativeImageData[] = []
      const ctx = {
        fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(),
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
        fillText: vi.fn(), strokeText: vi.fn(), arc: vi.fn(), scale: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 10 }),
        getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => new NativeImageData(width, height)),
        putImageData: vi.fn((pixels: unknown) => {
          // Canvas rejects a plain pixel object even when its fields look
          // identical. Require the native instance returned by readback.
          if (!(pixels instanceof NativeImageData)) throw new TypeError("Expected native ImageData")
          committed.push(pixels)
        }),
      }
      const canvas = { width: 0, height: 0, getContext: () => ctx }
      contexts.push({ canvas, drawImage: ctx.drawImage, putImageData: ctx.putImageData, committed })
      return canvas
    } })
    const plan = drawablePlan()
    plan.points[0].productId = "native-photo"
    const output = await renderPointMapFloor(plan, "first", {
      pointsOnly: true,
      productCircles: true,
      strictProductImages: true,
      products: [{ id: "native-photo", image: "/assets/products/native-photo.png" }],
    })
    const processed = contexts.find((context) => context.committed.length > 0)
    expect(processed, "the matte must be written to a drawable canvas rather than silently falling back").toBeDefined()
    expect(processed!.putImageData).toHaveBeenCalledOnce()
    const pixels = processed!.committed[0]
    expect(Object.keys(pixels)).not.toContain("width")
    expect(pixels.data[3]).toBe(0)
    expect(pixels.data[(24 * pixels.width + 24) * 4 + 3]).toBe(255)
    expect(pixels.data.filter((_value, index) => index % 4 === 3 && pixels.data[index] > 0).length).toBeGreaterThan(0)
    const rendered = contexts.at(-1)!
    expect(output).toBe(rendered.canvas)
    const photo = rendered.drawImage.mock.calls.find(([source]) => source === processed!.canvas)
    expect(photo, "the final circle must use the processed product photo").toBeDefined()
    expect(photo).toHaveLength(9)
    expect(photo!.slice(1).every((value) => Number.isFinite(value))).toBe(true)
    expect(photo![3]).toBeGreaterThan(0)
    expect(photo![4]).toBeGreaterThan(0)
    expect(photo![7]).toBeGreaterThan(0)
    expect(photo![8]).toBeGreaterThan(0)
  })

  it("uses unified customer-facing class labels on product circles instead of point codes", async () => {
    const { ctx } = mockDrawing()
    const plan = drawablePlan()
    plan.points[0].iconId = "switch-1"
    plan.points[0].code = "L1-K01"
    await renderPointMapFloor(plan, "first", { pointsOnly: true, productCircles: true })
    const labels = ctx.fillText.mock.calls.map(([text]) => text)
    expect(labels).toContain("单开")
    expect(labels).not.toContain("L1-K01")
  })

  it("makes customer product circles legible and exports enough pixels for zooming", async () => {
    const { ctx, canvas } = mockDrawing()
    await renderPointMapFloor(drawablePlan(), "first", { pointsOnly: true, productCircles: true })
    expect(ctx.arc.mock.calls[0][2] * 2).toBeGreaterThanOrEqual(100)
    expect(canvas.width).toBeGreaterThanOrEqual(3200)
    expect(canvas.width / canvas.height).toBeGreaterThan(1)
  })

  it("separates crowded product photos while retaining their installation anchors", async () => {
    const { ctx } = mockDrawing()
    const plan = drawablePlan()
    plan.points = [plan.points[0], { ...plan.points[0], id: "nearby", code: "K04", x: 25.5 }]
    const original = structuredClone(plan)
    await renderPointMapFloor(plan, "first", { pointsOnly: true, productCircles: true })
    const circles = ctx.arc.mock.calls.filter((call) => call[2] > 10)
    const centres = [...new Map(circles.map((call) => [`${call[0]},${call[1]}`, call])).values()]
    expect(centres).toHaveLength(2)
    expect(Math.hypot(centres[0][0] - centres[1][0], centres[0][1] - centres[1][1])).toBeGreaterThan(centres[0][2] * 2)
    expect(ctx.lineTo).toHaveBeenCalled()
    expect(plan).toEqual(original)
  })

  it("blocks a customer PDF if a linked photo fails instead of silently printing a category icon", async () => {
    const broken = "/assets/products/broken.png"
    mockDrawing(broken)
    const plan = drawablePlan()
    plan.points[0].productId = "selected-product"
    await expect(renderPointMapFloor(plan, "first", {
      pointsOnly: true,
      productCircles: true,
      strictProductImages: true,
      products: [{ id: "selected-product", image: broken }],
    })).rejects.toThrow("商品图片")
  })

  it("supports a temporary point-to-product mapping without changing the saved plan", async () => {
    const { ctx, loaded } = mockDrawing()
    const plan = drawablePlan()
    const mapping = new Map([[plan.points[0].id, "quote-product"]])
    await renderPointMapFloor(plan, "first", {
      pointsOnly: true,
      productCircles: true,
      productIdByPointId: mapping,
      products: [{ id: "quote-product", image: "/assets/products/sumi/sumi-h2u.png" }],
    })
    expect(loaded).toContain("/assets/products/sumi/sumi-h2u.png")
    expect(plan.points[0].productId).toBe("")
    expect(ctx.arc).toHaveBeenCalled()
  })

  it("exports the frozen model, independent key/relay requirements and measured materials", async () => {
    const { ctx } = mockDrawing()
    const plan = drawablePlan()
    plan.points = [{
      ...plan.points[0], iconId: "switch-3", deviceTypeId: "wall-switch", usage: "selected",
      requirements: { button_count: 3, relay_count: 2, wiring: "neutral" }, productId: "frozen-product",
      selection: { productId: "frozen-product", mappingRevision: 4, deviceTypeId: "wall-switch", sku: "FROZEN-SKU", name: "冻结的三键产品", manufacturerModel: "MODEL-FROZEN", specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: ["zigbee"], capabilities: ["load-control"], unit: "个", verifiedAt: "2026-10-14T00:00:00.000Z" },
      materials: [{ id: "track", productId: "track-sku", role: "track", quantity: 3.6, unit: "米", required: true, included: false }, { id: "head", productId: "", role: "accessory", quantity: null, unit: "只", required: true, included: false }],
    }]
    plan.scenes = []
    await renderPointMapFloor(plan, "first")
    const drawn = ctx.fillText.mock.calls.map(([text]) => text).join("")
    expect(drawn).toContain("图形库 v1")
    expect(drawn).toContain("冻结的三键产品")
    expect(drawn).toContain("MODEL-FROZEN")
    expect(drawn).toContain("物理按键数 3")
    expect(drawn).toContain("继电器路数 2")
    expect(drawn).toContain("3.6 米")
    expect(drawn).toContain("数量待测")
    expect(drawn).toContain("型号待选")
  })

  it("reports a missing device asset instead of silently exporting a letter or an empty marker", async () => {
    mockDrawing(pointIconDefinitions.find((icon) => icon.id === "switch-1")!.icon)
    await expect(renderPointMapFloor(drawablePlan(), "first")).rejects.toThrow("设备图标无法读取")
  })
})
