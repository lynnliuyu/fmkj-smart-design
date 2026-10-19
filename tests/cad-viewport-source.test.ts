import { describe, expect, it } from "vitest"
import { readDxfViewports, restoreLayoutViewports, sourceViewportProjection } from "../scripts/cadcraft/viewport-source.mjs"
import { viewportModelWindow } from "../scripts/export-cad-review.mjs"
const source = (handle = "A") => ({ handle, paperCenter: { x: 200, y: 150 }, displayCenter: { x: 20, y: 30 }, targetPoint: { x: 1000, y: 2000, z: 0 }, viewDirection: { x: 0, y: 0, z: 1 }, twistAngle: 0, width: 400, height: 200, viewHeight: 100, flags: 16384, frozenLayers: ["灯控"] })
const entity = (handle = "A") => ({ handle, geometry: { type: "viewport", center: { x: 200, y: 150 }, width: 400, height: 200, viewHeight: 100, viewCenter: { x: 20, y: 30 }, frozenLayers: ["旧图层"] } })
describe("原始 CAD 视口恢复", () => {
  it("读取 DXF 目标偏移和冻结图层，不能只用 CADCraft 丢失字段后的结果", () => {
    const pairs = [[0,"SECTION"],[2,"TABLES"],[0,"LAYER"],[5,"B"],[2,"\\U+706F\\U+63A7"],[0,"ENDSEC"],[0,"SECTION"],[2,"ENTITIES"],[0,"VIEWPORT"],[5,"A"],[10,200],[20,150],[12,20],[22,30],[17,1000],[27,2000],[40,400],[41,200],[45,100],[331,"B"],[0,"ENDSEC"],[0,"EOF"]]
    const meta = readDxfViewports(Buffer.from(pairs.flat().join("\n")+"\n")).viewports.get("A")
    expect(sourceViewportProjection(meta)).toEqual({ center: [1020,2030], window: [[920,1980],[1120,2080]], frozenLayers: ["灯控"] })
  })
  it("同一模型的定位图和开关图分别恢复图层，每次重开后重新设置并恢复锁定", async () => {
    const calls: unknown[] = [], client = { async execute(name: string, args: unknown) { calls.push([name,args]) } }
    const lighting = source(), controls = { ...source("B"), frozenLayers: ["尺寸"] }
    for (let reopen = 0; reopen < 2; reopen++) {
      const result = await restoreLayoutViewports(client,new Map([["A",lighting],["B",controls]]),[entity(),entity("B")])
      expect(viewportModelWindow(result.get("A"))).toEqual([[920,1980],[1120,2080]])
      expect(result.get("A").geometry.frozenLayers).toEqual(["灯控"])
      expect(result.get("B").geometry.frozenLayers).toEqual(["尺寸"])
    }
    expect(calls).toHaveLength(12)
    expect(calls.slice(0,3)).toEqual([["viewport.set",{handle:"A",locked:false}],["viewport.set",{handle:"A",center:[1020,2030],viewHeight:100,thaw:["旧图层"],freeze:["灯控"]}],["viewport.set",{handle:"A",locked:true}]])
  })
  it("缺失参数、三维或旋转视口必须报错，不能标成历史空白页", async () => {
    expect(()=>sourceViewportProjection({...source(),twistAngle:1})).toThrow("不能导出为空页")
    expect(()=>sourceViewportProjection({...source(),viewDirection:{x:1,y:0,z:1}})).toThrow()
    expect(()=>sourceViewportProjection({...source(),targetPoint:undefined})).toThrow("参数不完整")
    await expect(restoreLayoutViewports({},new Map(),[entity()])).rejects.toThrow("缺少原图参数")
    expect(()=>readDxfViewports(Buffer.from("invalid"))).toThrow("结构无效")
  })
})
