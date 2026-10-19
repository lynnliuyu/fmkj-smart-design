import { describe, expect, it } from "vitest"
import { exportPointMapDraft, importPointMapDraft, normalizeDesignPlan, parsePointMapDraft, validateDesignPlan } from "../lib/point-map-design"
import { emptyPointMapPlan, readPointMapPlan, writePointMapPlan, type PointMapFloor, type PointMapPlan, type PointMapPresentation } from "../lib/point-map-plan"
import { applyPointMapPresentationBundle, fingerprintFloorplan, measurePresentationCalibration, parsePointMapPresentation, resolvePointMapBackground } from "../lib/point-map-presentation"

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

function presentation(): PointMapPresentation {
  return {
    name: "一楼 · 无点位风格净底",
    imageDataUrl: png,
    imageWidth: 1200,
    imageHeight: 900,
    sourceFingerprint: "a".repeat(64),
    matrix: [0.8, 0, 0, 0.8, 10, 10],
    anchors: [
      { source: { x: 10, y: 10 }, target: { x: 18, y: 18 } },
      { source: { x: 90, y: 10 }, target: { x: 82, y: 18 } },
      { source: { x: 10, y: 90 }, target: { x: 18, y: 82 } },
      { source: { x: 90, y: 90 }, target: { x: 82, y: 82 } },
    ],
  }
}

function floor(): PointMapFloor {
  return {
    id: "one", name: "一楼", floorplanName: "CAD净底.png", floorplanDataUrl: png,
    imageWidth: 1000, imageHeight: 1000,
    cad: { format: "cadcraft", version: 1, drawingId: "drawing-one", drawingSha256: "b".repeat(64), window: [0, 0, 1000, 1000] },
  }
}

describe("presentation background validation", () => {
  it("accepts full-building internal anchors and preserves independent engineering geometry", () => {
    const original = presentation()
    const parsed = parsePointMapPresentation(original)
    expect(parsed).toEqual(original)
    parsed.matrix[0] = 1
    parsed.anchors[0].source.x = 15
    expect(original.matrix[0]).toBe(.8)
    expect(original.anchors[0].source.x).toBe(10)
  })

  it("measures and preserves small AI drawing differences rather than requiring identical pixels", () => {
    const input = presentation()
    input.anchors[3].target.x += 1.2
    input.anchors[3].target.y += .5
    expect(parsePointMapPresentation(input)).toEqual(input)
    const calibration = measurePresentationCalibration(input)
    expect(calibration.anchorCount).toBe(4)
    expect(calibration.maxResidualPercent).toBeCloseTo(1.3)
    expect(calibration.rmsResidualPercent).toBeCloseTo(.65)
  })

  it("accepts limited padding beyond the engineering image corners", () => {
    const input = presentation()
    input.matrix = [1, 0, 0, 1, -3, 2]
    input.anchors = input.anchors.map(({ source }) => ({ source, target: { x: source.x - 3, y: source.y + 2 } }))
    expect(parsePointMapPresentation(input).matrix).toEqual(input.matrix)
  })

  it.each([
    ["remote image", (input: Record<string, unknown>) => { input.imageDataUrl = "https://example.com/style.png" }],
    ["SVG image", (input: Record<string, unknown>) => { input.imageDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }],
    ["wrong image bytes", (input: Record<string, unknown>) => { input.imageDataUrl = "data:image/png;base64,PHN2Zz48L3N2Zz4=" }],
    ["empty image", (input: Record<string, unknown>) => { input.imageDataUrl = "" }],
    ["empty name", (input: Record<string, unknown>) => { input.name = " " }],
    ["zero width", (input: Record<string, unknown>) => { input.imageWidth = 0 }],
    ["fractional height", (input: Record<string, unknown>) => { input.imageHeight = 10.5 }],
    ["infinite height", (input: Record<string, unknown>) => { input.imageHeight = Infinity }],
    ["missing fingerprint", (input: Record<string, unknown>) => { delete input.sourceFingerprint }],
    ["invalid fingerprint", (input: Record<string, unknown>) => { input.sourceFingerprint = "not-a-sha" }],
    ["unknown field", (input: Record<string, unknown>) => { input.command = "open source" }],
    ["missing matrix", (input: Record<string, unknown>) => { delete input.matrix }],
    ["short matrix", (input: Record<string, unknown>) => { input.matrix = [1, 0, 0] }],
    ["non-finite matrix", (input: Record<string, unknown>) => { input.matrix = [Infinity, 0, 0, 1, 0, 0] }],
    ["numeric string matrix", (input: Record<string, unknown>) => { input.matrix = ["1", 0, 0, 1, 0, 0] }],
    ["singular matrix", (input: Record<string, unknown>) => { input.matrix = [1, 1, 1, 1, 0, 0] }],
    ["mirrored matrix", (input: Record<string, unknown>) => { input.matrix = [-1, 0, 0, 1, 100, 0] }],
    ["tiny scale", (input: Record<string, unknown>) => { input.matrix = [.01, 0, 0, 1, 0, 0] }],
    ["huge scale", (input: Record<string, unknown>) => { input.matrix = [11, 0, 0, 1, 0, 0] }],
    ["cropped engineering range", (input: Record<string, unknown>) => { input.matrix = [1, 0, 0, 1, 10, 0] }],
    ["too few anchors", (input: Record<string, unknown>) => { input.anchors = presentation().anchors.slice(0, 2) }],
    ["local calibration", (input: Record<string, unknown>) => { input.anchors = [
      { source: { x: 40, y: 40 }, target: { x: 42, y: 42 } },
      { source: { x: 60, y: 40 }, target: { x: 58, y: 42 } },
      { source: { x: 40, y: 60 }, target: { x: 42, y: 58 } },
    ] }],
    ["collinear anchors", (input: Record<string, unknown>) => { input.anchors = [
      { source: { x: 10, y: 10 }, target: { x: 18, y: 18 } },
      { source: { x: 50, y: 50 }, target: { x: 50, y: 50 } },
      { source: { x: 90, y: 90 }, target: { x: 82, y: 82 } },
    ] }],
    ["out of bounds target", (input: Record<string, unknown>) => { input.anchors = [{ source: { x: 0, y: 0 }, target: { x: -6, y: 0 } }, ...presentation().anchors] }],
    ["out of bounds source", (input: Record<string, unknown>) => { input.anchors = [{ source: { x: -1, y: 0 }, target: { x: 0, y: 0 } }, ...presentation().anchors] }],
    ["large residual", (input: Record<string, unknown>) => {
      const anchors = presentation().anchors
      anchors[3].target.x += 3
      input.anchors = anchors
    }],
  ])("rejects %s", (_name, mutate) => {
    const input = presentation() as unknown as Record<string, unknown>
    mutate(input)
    expect(() => parsePointMapPresentation(input)).toThrow()
  })
})

describe("presentation source resolution", () => {
  it("hashes the exact engineering image source using SHA-256", async () => {
    expect(await fingerprintFloorplan("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(await fingerprintFloorplan(png)).not.toBe(await fingerprintFloorplan(`${png}changed`))
  })

  it("defaults to the engineering background for existing floors with no presentation", async () => {
    const source = floor()
    const resolved = await resolvePointMapBackground(source)
    expect(resolved).toMatchObject({ kind: "engineering", src: png, width: 1000, height: 1000 })
    expect(resolved.transformPoint({ x: 12.5, y: 80 })).toEqual({ x: 12.5, y: 80 })
  })

  it("resolves an independent style background and maps engineering-percent positions", async () => {
    const source = floor()
    source.presentation = { ...presentation(), sourceFingerprint: await fingerprintFloorplan(png) }
    const before = structuredClone(source)
    const resolved = await resolvePointMapBackground(source)
    expect(resolved).toMatchObject({ kind: "presentation", src: png, width: 1200, height: 900 })
    expect(resolved.transformPoint({ x: 25, y: 75 })).toEqual({ x: 30, y: 70 })
    expect(resolved.calibration).toMatchObject({ maxResidualPercent: 0, rmsResidualPercent: 0, anchorCount: 4 })
    expect(source).toEqual(before)
  })

  it("rejects stale style calibration after the engineering background is replaced", async () => {
    const source = { ...floor(), presentation: presentation() }
    await expect(resolvePointMapBackground(source)).rejects.toThrow("工程底图已变更")
    const engineering = await resolvePointMapBackground(source, "engineering")
    expect(engineering.kind).toBe("engineering")
    expect(engineering.transformPoint({ x: 20, y: 80 })).toEqual({ x: 20, y: 80 })
  })

  it("rejects uncalibrated presentation objects instead of falling back to CAD", async () => {
    const source = { ...floor(), presentation: { ...presentation(), matrix: [0, 0, 0, 0, 0, 0] } } as PointMapFloor
    await expect(resolvePointMapBackground(source)).rejects.toThrow("校准")
  })
})

describe("presentation schema persistence", () => {
  function design(): PointMapPlan {
    return { ...emptyPointMapPlan("project"), floors: [{ ...floor(), presentation: presentation() }], activeFloorId: "one" }
  }

  it("keeps CAD geometry and the separate style through strict save, export and import", () => {
    const original = design()
    const validated = validateDesignPlan(original)
    const exported = exportPointMapDraft(validated)
    const parsed = parsePointMapDraft(JSON.stringify(exported))
    const imported = importPointMapDraft(emptyPointMapPlan("other-project"), parsed).plan
    expect(imported.floors?.[0]).toEqual(original.floors?.[0])
    expect(imported.floors?.[0].floorplanDataUrl).toBe(png)
    expect(imported.floors?.[0].cad).toEqual(floor().cad)
  })

  it("deep-copies style calibration and preserves it through local storage", () => {
    const original = design()
    const normalized = normalizeDesignPlan(original)
    normalized.floors![0].presentation!.anchors[0].target.x = 19
    expect(original.floors![0].presentation!.anchors[0].target.x).toBe(18)
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    writePointMapPlan(original, storage)
    expect(readPointMapPlan("project", storage).floors?.[0].presentation).toEqual(presentation())
  })

  it("rejects malformed style metadata on the strict cloud save path", () => {
    const original = design()
    original.floors![0].presentation!.anchors = []
    expect(() => validateDesignPlan(original)).toThrow("校准")
  })
})

describe("calibrated presentation bundle import", () => {
  function design(): PointMapPlan {
    return {
      ...emptyPointMapPlan("project", () => "2026-10-14T00:00:00.000Z"),
      floors: [floor(), { ...floor(), id: "two", name: "二楼", presentation: presentation() }],
      activeFloorId: "one",
      points: [{ id: "K01", code: "K01", floorId: "one", name: "玄关开关", room: "玄关", iconId: "switch-1", productId: "switch-product", placed: true, status: "confirmed", x: 12, y: 34, note: "已复核" }],
      scenes: [{ id: "home", name: "回家", trigger: "面板", description: "打开玄关灯", pointIds: ["K01"], status: "confirmed" }],
    }
  }

  async function bundle() {
    return {
      format: "fmkj-point-map-presentations", version: 1, projectId: "project",
      floors: [{ floorId: "one", presentation: { ...presentation(), sourceFingerprint: await fingerprintFloorplan(png) } }],
    }
  }

  it("attaches only the calibrated presentation without changing engineering data, points or scenes", async () => {
    const original = design()
    const before = structuredClone(original)
    const input = await bundle()
    const next = await applyPointMapPresentationBundle(original, input)
    expect(next).not.toBe(original)
    expect(next.floors?.[0]).toEqual({ ...original.floors![0], presentation: input.floors[0].presentation })
    expect(next.floors?.[1]).toBe(original.floors![1])
    expect(next.points).toBe(original.points)
    expect(next.scenes).toBe(original.scenes)
    expect(next.activeFloorId).toBe(original.activeFloorId)
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt))
    expect(original).toEqual(before)
  })

  it("replaces an existing style calibration and accepts serialized JSON", async () => {
    const original = design()
    original.floors![0].presentation = presentation()
    const input = await bundle()
    input.floors[0].presentation.name = "重新校准的风格图"
    const next = await applyPointMapPresentationBundle(original, JSON.stringify(input))
    expect(next.floors?.[0].presentation?.name).toBe("重新校准的风格图")
    expect(original.floors?.[0].presentation?.name).toBe("一楼 · 无点位风格净底")
  })

  it("copies imported presentation metadata so future caller edits cannot change the saved plan", async () => {
    const input = await bundle()
    const next = await applyPointMapPresentationBundle(design(), input)
    input.floors[0].presentation.anchors[0].target.x = 70
    expect(next.floors?.[0].presentation?.anchors[0].target.x).toBe(18)
  })

  it.each([
    ["format", (input: Record<string, unknown>) => { input.format = "another-format" }],
    ["version", (input: Record<string, unknown>) => { input.version = 2 }],
    ["project", (input: Record<string, unknown>) => { input.projectId = "another-project" }],
    ["unknown bundle field", (input: Record<string, unknown>) => { input.instructions = "replace the engineering plan" }],
    ["missing bundle field", (input: Record<string, unknown>) => { delete input.projectId }],
    ["empty floors", (input: Record<string, unknown>) => { input.floors = [] }],
    ["too many floors", (input: Record<string, unknown>) => { input.floors = Array.from({ length: 101 }, (_, index) => ({ floorId: `floor-${index}`, presentation: presentation() })) }],
    ["unknown floor", (input: Record<string, unknown>) => { input.floors = [{ floorId: "missing", presentation: presentation() }] }],
    ["unknown floor field", (input: Record<string, unknown>) => { input.floors = [{ floorId: "one", presentation: presentation(), cad: {} }] }],
    ["duplicate floor", (input: Record<string, unknown>) => { const first = (input.floors as unknown[])[0]; input.floors = [first, first] }],
    ["bad calibration", (input: Record<string, unknown>) => { input.floors = [{ floorId: "one", presentation: { ...presentation(), anchors: [] } }] }],
    ["stale engineering fingerprint", (input: Record<string, unknown>) => { input.floors = [{ floorId: "one", presentation: presentation() }] }],
  ])("rejects %s without modifying any part of the current plan", async (_name, mutate) => {
    const original = design()
    const before = structuredClone(original)
    const input = await bundle() as unknown as Record<string, unknown>
    mutate(input)
    await expect(applyPointMapPresentationBundle(original, input)).rejects.toThrow()
    expect(original).toEqual(before)
  })

  it("applies no floor when a later floor fails validation", async () => {
    const original = design()
    const before = structuredClone(original)
    const input = await bundle()
    input.floors.push({ floorId: "two", presentation: { ...presentation(), sourceFingerprint: "c".repeat(64) } })
    await expect(applyPointMapPresentationBundle(original, input)).rejects.toThrow("工程底图")
    expect(original).toEqual(before)
    expect(original.floors?.[0].presentation).toBeUndefined()
  })

  it.each([0, -1, Infinity, 10.5])("requires complete positive engineering dimensions (%s)", async (width) => {
    const original = design()
    original.floors![0].imageWidth = width
    const before = structuredClone(original)
    await expect(applyPointMapPresentationBundle(original, await bundle())).rejects.toThrow("工程底图")
    expect(original).toEqual(before)
  })

  it("rejects malformed JSON without changing the current plan", async () => {
    const original = design()
    const before = structuredClone(original)
    await expect(applyPointMapPresentationBundle(original, "{invalid")).rejects.toThrow("JSON")
    expect(original).toEqual(before)
  })
})
