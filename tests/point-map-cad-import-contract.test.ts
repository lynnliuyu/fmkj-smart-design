import { describe, expect, it } from "vitest"
import { parsePointMapDraft } from "../lib/point-map-design"

/**
 * 托管侧 CAD 提取（scripts/cadcraft/extract-points.py）与设计站草稿契约的对接测试。
 * 该 fixture 按提取脚本的真实输出结构构造，覆盖本轮实测中真实踩到的三条约束：
 * sourcePage 必须是数字、room 必须非空、x/y 必须是图片百分比。
 */
const extractedDraft = {
  format: "fmkj-point-map-draft",
  version: 1,
  coordinateSystem: "image-percent",
  floors: [
    { id: "floor-page-029", name: "一层-灯具", floorplanName: "page-029.png", floorplanDataUrl: "data:image/png;base64,iVBORw0KGgo=", imageWidth: 3000, imageHeight: 2121, sourcePage: 29 },
  ],
  points: [
    { id: "page-029-L-001", name: "筒灯/灯具 L-001", room: "未分房间", iconId: "downlight", status: "planned", x: 41.2, y: 63.8, productId: "", note: "", placed: false, floorId: "floor-page-029", code: "L-001", source: "analysis", confidence: "medium", reviewReason: "按图层归类，需人工复核。" },
    { id: "page-029-S-001", name: "开关 S-001", room: "未分房间", iconId: "switch-1", status: "planned", x: 55.5, y: 71.1, productId: "", note: "", placed: false, floorId: "floor-page-029", code: "S-001", source: "analysis", confidence: "medium", reviewReason: "按图层归类，需人工复核。" },
  ],
  scenes: [],
}

describe("CAD 提取草稿与设计站契约", () => {
  it("提取结果可直接被设计站导入器解析", () => {
    const draft = parsePointMapDraft(extractedDraft)
    expect(draft.floors).toHaveLength(1)
    expect(draft.points).toHaveLength(2)
    expect(draft.points.map(point => point.iconId)).toEqual(["downlight", "switch-1"])
    expect(draft.coordinateSystem).toBe("image-percent")
  })

  it("拒绝字符串页号，避免与设计站的数字页号契约不一致", () => {
    const broken = { ...extractedDraft, floors: [{ ...extractedDraft.floors[0], sourcePage: "page-029" }] }
    expect(() => parsePointMapDraft(broken)).toThrow(/sourcePage/)
  })

  it("拒绝空房间名：CAD 图块无法判断房间时必须给出明确占位值", () => {
    const broken = { ...extractedDraft, points: [{ ...extractedDraft.points[0], room: "" }] }
    expect(() => parsePointMapDraft(broken)).toThrow(/room/)
  })

  it("接受按模型窗口构建的楼层（CAD 绑定、比例一致、底图内嵌）", () => {
    // build-floor.py 的真实输出结构：窗口 23766.6 x 18570.6 → 底图 3000 x 2358（比例一致）。
    const window: [number, number, number, number] = [860589.4, -554338.5, 884230.2, -535767.8]
    const floorDraft = {
      ...extractedDraft,
      floors: [{ id: "floor-1", name: "一层", floorplanName: "base.png", floorplanDataUrl: "data:image/png;base64,iVBORw0KGgo=", imageWidth: 3000, imageHeight: 2358,
        sourcePage: 29,
        cad: { format: "cadcraft", version: 1, drawingId: "一层-page-029-page-030", drawingSha256: "b".repeat(64), window } }],
      points: [{ ...extractedDraft.points[0], floorId: "floor-1" }, { ...extractedDraft.points[1], floorId: "floor-1" }],
    }
    const draft = parsePointMapDraft(floorDraft)
    expect(draft.floors[0].cad?.window).toEqual(window)
    expect(draft.points.every(point => point.floorId === "floor-1")).toBe(true)
  })

  it("拒绝与 CAD 窗口比例不符的底图（A3 纸强行输出会被拒绝）", () => {
    const window: [number, number, number, number] = [860589.4, -554338.5, 884230.2, -535767.8]
    const a3 = {
      ...extractedDraft,
      floors: [{ id: "floor-1", name: "一层", floorplanName: "base.png", floorplanDataUrl: "data:image/png;base64,iVBORw0KGgo=", imageWidth: 3000, imageHeight: 2121,
        cad: { format: "cadcraft", version: 1, drawingId: "一层-page-029", drawingSha256: "b".repeat(64), window } }],
      points: [{ ...extractedDraft.points[0], floorId: "floor-1" }],
    }
    expect(() => parsePointMapDraft(a3)).toThrow(/比例不符/)
  })

  it("拒绝字段多余的 CAD 绑定", () => {
    const broken = {
      ...extractedDraft,
      floors: [{ ...extractedDraft.floors[0], cad: { format: "cadcraft", version: 1, drawingId: "x", drawingSha256: "b".repeat(64), window: [0, 0, 100, 100], kind: "model-window" } }],
    }
    expect(() => parsePointMapDraft(broken)).toThrow(/CAD 底图绑定/)
  })

  it("拒绝超出图片百分比的坐标", () => {
    const broken = { ...extractedDraft, points: [{ ...extractedDraft.points[0], x: 120 }] }
    expect(() => parsePointMapDraft(broken)).toThrow()
  })
})
