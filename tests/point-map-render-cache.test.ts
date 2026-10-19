import { describe, expect, it, vi } from "vitest"
import { createBrowserPointMapFloorRenderCache, createMemoryPointMapFloorRenderCache, pointMapFloorRenderKey } from "../lib/point-map-render-cache"
import { renderPointMapPrintFloors, releasePointMapPrintFloors } from "../lib/point-map-print"
import { renderPointMapFloor } from "../lib/point-map-render"
import type { PointMapPlan } from "../lib/point-map-plan"

vi.mock("../lib/point-map-render", () => ({ renderPointMapFloor: vi.fn(), getPointMapRenderGeometry: vi.fn() }))
function fixture(): PointMapPlan {
  return {
    projectId: "cache-test", floorplanName: "", floorplanDataUrl: "", updatedAt: "2026-10-15T00:00:00Z",
    floors: ["one", "two"].map((id) => ({ id, name: id, floorplanName: `${id}.png`, floorplanDataUrl: `data:image/png;base64,${id}`, imageWidth: 100, imageHeight: 100 })),
    points: ["one", "two"].map((floorId) => ({ id: `${floorId}-point`, floorId, code: floorId, name: "开关", room: "客厅", iconId: "switch-1", x: 50, y: 50, status: "planned", placed: true, productId: `${floorId}-product`, note: "" })),
    scenes: [],
  }
}
const products = [{ id: "one-product", image: "/one.png" }, { id: "two-product", image: "/two.png" }]
const rows = [{ id: "one-product", pointIds: ["one-point"], image: "/one.png", price: 10 }, { id: "two-product", pointIds: ["two-point"], image: "/two.png", price: 20 }]

describe("incremental point-map rendering", () => {
  it("reuses unchanged floors and ignores prices, dates and scene prose", async () => {
    vi.mocked(renderPointMapFloor).mockClear()
    vi.mocked(renderPointMapFloor).mockImplementation(async (_, id) => ({ width: 100, height: 100, toDataURL: () => `data:image/png;base64,${id}` }) as HTMLCanvasElement)
    const plan = fixture()
    const cache = createMemoryPointMapFloorRenderCache()
    await renderPointMapPrintFloors(plan, rows, products, { cache })
    const changed = structuredClone(plan)
    changed.updatedAt = "2026-10-16T00:00:00Z"
    changed.scenes = [{ id: "scene", name: "晚安", trigger: "按键", description: "新文案", status: "confirmed", pointIds: ["one-point"] }]
    const unchanged = await renderPointMapPrintFloors(changed, rows.map((row) => ({ ...row, price: row.price + 300 })), products, { cache })
    expect(renderPointMapFloor).toHaveBeenCalledTimes(2)
    expect(unchanged.every((floor) => floor.reused)).toBe(true)
    changed.points[0].x = 60
    const moved = await renderPointMapPrintFloors(changed, rows, products, { cache })
    expect(renderPointMapFloor).toHaveBeenCalledTimes(3)
    expect(moved.map((floor) => floor.reused)).toEqual([false, true])
    const photos = await renderPointMapPrintFloors(changed, [{ ...rows[0], image: "/replacement.png" }, rows[1]], products, { cache })
    expect(renderPointMapFloor).toHaveBeenCalledTimes(4)
    expect(photos.map((floor) => floor.reused)).toEqual([false, true])
  })

  it("isolates project, frozen history, display offsets, crop and presentation content", async () => {
    const plan = fixture()
    const mapping = new Map([["one-point", "one-product"]])
    const key = await pointMapFloorRenderKey(plan, "one", products, mapping)
    expect(await pointMapFloorRenderKey({ ...plan, projectId: "another" }, "one", products, mapping)).not.toBe(key)
    expect(await pointMapFloorRenderKey(plan, "one", products, mapping, "history-1")).not.toBe(key)
    const moved = structuredClone(plan)
    moved.points[0].display = { markerOffset: { x: 1, y: 1 }, labelOffset: { x: 0, y: 0 } }
    expect(await pointMapFloorRenderKey(moved, "one", products, mapping)).not.toBe(key)
    moved.points[0].display = undefined
    moved.floors![0].floorplanDataUrl += "updated"
    expect(await pointMapFloorRenderKey(moved, "one", products, mapping)).not.toBe(key)
    const visual = { image: "/one.png", sourceImage: "/source.png", crop: { x: 0, y: 0, width: .5, height: .5 }, scale: 1.2, revision: 2, updatedAt: "now", reviewStatus: "series" as const }
    expect(await pointMapFloorRenderKey(plan, "one", [{ ...products[0], visualAsset: visual }], mapping)).not.toBe(key)
    const frozen = [{ ...products[0], image: "data:image/png;base64,frozen", visualAsset: visual }]
    expect(await pointMapFloorRenderKey(plan, "one", frozen, mapping)).not.toBe(await pointMapFloorRenderKey(plan, "one", [{ ...products[0], image: "data:image/png;base64,other", visualAsset: visual }], mapping))
  })

  it("bounds memory and falls back when persistent browser storage is unavailable", async () => {
    const cache = createMemoryPointMapFloorRenderCache(1, 100)
    await cache.put("one", { dataUrl: "one" })
    await cache.put("two", { dataUrl: "two" })
    expect(await cache.get("one")).toBeUndefined()
    expect(await cache.get("two")).toMatchObject({ dataUrl: "two" })
    await cache.put("large", { dataUrl: "x".repeat(100) })
    expect(await cache.get("large")).toBeUndefined()
    const browser = createBrowserPointMapFloorRenderCache()
    await browser.put("working", { dataUrl: "works" })
    expect(await browser.get("working")).toMatchObject({ dataUrl: "works" })
  })

  it("uses blobs and releases each view-owned URL only after its owner releases it", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL")
    vi.mocked(renderPointMapFloor).mockImplementation(async () => ({ width: 100, height: 100, toBlob: (callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })) }) as HTMLCanvasElement)
    const cache = createMemoryPointMapFloorRenderCache()
    const first = await renderPointMapPrintFloors(fixture(), rows, products, { cache })
    const second = await renderPointMapPrintFloors(fixture(), rows, products, { cache })
    expect(first[0].src.startsWith("blob:")).toBe(true)
    expect(second[0].src).not.toBe(first[0].src)
    releasePointMapPrintFloors(first)
    expect(revoke).toHaveBeenCalledWith(first[0].src)
    expect(revoke).not.toHaveBeenCalledWith(second[0].src)
    releasePointMapPrintFloors(second)
    revoke.mockRestore()
  })
})
