import { afterEach, describe, expect, it, vi } from "vitest"
import { renderPointMapPrintFloors, waitForPrintImages } from "../lib/point-map-print"
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan"
import { renderPointMapFloor } from "../lib/point-map-render"

vi.mock("../lib/point-map-render", () => ({ renderPointMapFloor: vi.fn(), getPointMapRenderGeometry: vi.fn() }))

function fixture(): PointMapPlan {
  return {
    ...emptyPointMapPlan("project"),
    floors: [
      { id: "one", name: "一楼", floorplanName: "one.png", floorplanDataUrl: "data:image/png;base64,one", imageWidth: 100, imageHeight: 100 },
      { id: "two", name: "二楼", floorplanName: "two.png", floorplanDataUrl: "data:image/png;base64,two", imageWidth: 100, imageHeight: 100 },
    ],
    points: [
      { id: "a", floorId: "one", code: "K01", name: "开关", room: "客厅", iconId: "switch-1", x: 10, y: 20, productId: "", placed: true, status: "planned", note: "" },
      { id: "b", floorId: "two", code: "K02", name: "开关", room: "卧室", iconId: "switch-1", x: 30, y: 40, productId: "", placed: true, status: "planned", note: "" },
    ],
  }
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

describe("live product point-map pages for PDF", () => {
  function mockCanvas() {
    vi.mocked(renderPointMapFloor).mockImplementation(async (_, floorId) => ({
      width: 100, height: 100, toDataURL: () => `data:image/png;base64,rendered-${floorId}`,
    }) as HTMLCanvasElement)
  }

  it("prints current quote product photos for each floor, rather than static presentation PNGs", async () => {
    mockCanvas()
    const plan = fixture()
    const rows = [{ id: "p1", image: "/products/current.png", pointIds: ["a"] }, { id: "p2", image: "/products/upstairs.png", pointIds: ["b"] }]
    const pages = await renderPointMapPrintFloors(plan, rows, [])
    expect(pages.map((page) => page.src)).toEqual(["data:image/png;base64,rendered-one", "data:image/png;base64,rendered-two"])
    expect(vi.mocked(renderPointMapFloor).mock.calls[0][2]).toMatchObject({
      products: [{ id: "p1", image: "/products/current.png" }],
      productIdByPointId: new Map([["a", "p1"]]),
      productCircles: true, pointsOnly: true, strictProductImages: true, background: "presentation",
    })
    expect(vi.mocked(renderPointMapFloor).mock.calls[1][2]?.products).toEqual([{ id: "p2", image: "/products/upstairs.png" }])
    plan.points[0].x = 70
    await renderPointMapPrintFloors(plan, [{ id: "new", image: "/products/replacement.png", pointIds: ["a"] }], [])
    const call = vi.mocked(renderPointMapFloor).mock.calls[2]
    expect(call[0].points[0].x).toBe(70)
    expect(call[2]?.products).toEqual([{ id: "new", image: "/products/replacement.png" }])
  })

  it("propagates broken photos instead of falling back to old floor images", async () => {
    vi.mocked(renderPointMapFloor).mockRejectedValue(new Error("商品图片无法读取"))
    await expect(renderPointMapPrintFloors(fixture(), [], [])).rejects.toThrow("商品图片无法读取")
  })

  it("skips unused template floors but blocks positioned devices without a base", async () => {
    mockCanvas()
    const plan = fixture()
    plan.floors![1].floorplanDataUrl = ""
    plan.points[1].placed = false
    expect(await renderPointMapPrintFloors(plan, [], [])).toHaveLength(1)
    plan.points[1].placed = true
    await expect(renderPointMapPrintFloors(plan, [], [])).rejects.toThrow("二楼 尚未上传底图")
  })

  it("waits for every committed image to decode before printing", async () => {
    let finish!: () => void
    const ready = new Promise<void>((resolve) => { finish = resolve })
    const decode = vi.fn(() => ready)
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } })
    const root = { querySelectorAll: () => [{ decode }] } as unknown as HTMLElement
    let done = false
    const result = waitForPrintImages(root).then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    expect(decode).toHaveBeenCalledOnce()
    finish()
    await result
    expect(done).toBe(true)
  })
})
