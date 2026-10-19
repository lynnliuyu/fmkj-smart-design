import { describe, expect, it } from "vitest"
import { normalizePointMapDisplay, readPointMapPlan, writePointMapPlan, type PointMapPlan } from "../lib/point-map-plan"
import { exportPointMapDraft, parsePointMapDraft, validateDesignPlan } from "../lib/point-map-design"
import { movePointMapDisplay, pointMapDisplayFromGeometry, resetPointMapDisplay } from "../lib/point-map-display"
import type { PointMapRenderGeometry } from "../lib/point-map-render"
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
const geometry: PointMapRenderGeometry = { width: 3200, height: 1600, image: { x: 5, y: 5, width: 90, height: 90 }, markers: [{ pointId: "point", label: "单开", anchor: { x: 20, y: 30 }, marker: { x: 25, y: 30, radiusX: 2, radiusY: 4 }, labelRect: { x: 23, y: 36, width: 4, height: 2 }, labelBase: { x: 23, y: 35 } }] }
function fixture(): PointMapPlan { return { projectId: "display", floorplanName: "", floorplanDataUrl: "", updatedAt: "2026-10-15T00:00:00Z", floors: [{ id: "one", name: "一楼", floorplanName: "one.png", floorplanDataUrl: image, imageWidth: 100, imageHeight: 100 }], points: [{ id: "point", floorId: "one", name: "开关", room: "客厅", iconId: "switch-1", x: 10, y: 20, status: "confirmed", placed: true, productId: "sku", note: "" }] } }

describe("independent customer circle placement", () => {
  it("starts from rendered collision geometry, moves the display and keeps engineering coordinates and confirmation", () => {
    const plan = fixture()
    const display = pointMapDisplayFromGeometry(geometry, "point")
    expect(display.markerOffset.x).toBeCloseTo(5 / 90 * 100)
    expect(display.labelOffset.y).toBeCloseTo(1 / 90 * 100)
    const next = movePointMapDisplay(plan, geometry, "point", "marker", { x: 2, y: -3 })
    expect(next.points[0]).toMatchObject({ x: 10, y: 20, status: "confirmed", productId: "sku" })
    expect(next.points[0].display!.markerOffset.x).toBeCloseTo(7 / 90 * 100)
    expect(next.points[0].display!.labelOffset).toEqual(display.labelOffset)
    const labelled = movePointMapDisplay(next, geometry, "point", "label", { x: 1, y: 0 })
    expect(labelled.points[0].display!.markerOffset).toEqual(next.points[0].display!.markerOffset)
    expect(labelled.points[0].display!.labelOffset.x).toBeCloseTo(1 / 90 * 100)
    expect(resetPointMapDisplay(labelled, "point").points[0].display).toBeUndefined()
    expect(plan.points[0].display).toBeUndefined()
  })

  it("preserves display offsets through local storage, server validation and portable drafts", () => {
    const next = movePointMapDisplay(fixture(), geometry, "point", "marker", { x: 2, y: -3 })
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    writePointMapPlan(next, storage)
    const local = readPointMapPlan("display", storage)
    expect(local.points[0].display).toEqual(next.points[0].display)
    expect(validateDesignPlan(local).points[0].display).toEqual(next.points[0].display)
    expect(parsePointMapDraft(exportPointMapDraft(local)).points[0].display).toEqual(next.points[0].display)
  })

  it.each([null, {}, { markerOffset: { x: 0, y: 0 }, labelOffset: { x: NaN, y: 0 } }, { markerOffset: { x: 21, y: 0 }, labelOffset: { x: 0, y: 0 } }])("rejects invalid display offsets %s", (value) => {
    expect(() => normalizePointMapDisplay(value)).toThrow("展示偏移")
  })
})
