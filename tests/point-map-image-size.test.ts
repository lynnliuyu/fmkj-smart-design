import { describe, expect, it } from "vitest"
import { pointMapEditorGeometry, pointMapImageSize } from "../lib/point-map-image-size.mjs"
import { buildPointMapRenderLayout } from "../lib/point-map-render"
import { emptyPointMapPlan } from "../lib/point-map-plan"

describe("统一底图和点位比例", () => {
  it("小图、大图、竖图均使用长边 3000，保持宽高比", () => {
    expect(pointMapImageSize(600,400)).toEqual({width:3000,height:2000})
    expect(pointMapImageSize(6000,4000)).toEqual({width:3000,height:2000})
    expect(pointMapImageSize(400,600)).toEqual({width:2000,height:3000})
    expect(()=>pointMapImageSize(0,100)).toThrow()
  })
  it("不同来源分辨率共用逻辑画布，窗口只改变整图适配比例", () => {
    const small=pointMapEditorGeometry({width:3000,height:2000},{width:640,height:480})
    const large=pointMapEditorGeometry({width:900,height:600},{width:1280,height:900})
    expect(small.width).toBe(large.width)
    expect(small.height).toBe(large.height)
    expect(small.fitScale).toBeLessThan(large.fitScale)
    expect(small.markerScale * small.fitScale).toBeCloseTo(1)
  })
  it("编辑图标在全图和放大时都保持可辨认的屏幕尺寸", () => {
    const geometry=pointMapEditorGeometry({width:3000,height:2000},{width:390,height:480})
    for(const zoom of [.5,1,3,8]) {
      const screenScale=geometry.fitScale*zoom
      const correction="markerScale" in geometry ? Number(geometry.markerScale)/zoom : 1
      expect(32*screenScale*correction).toBeCloseTo(32)
    }
  })
  it("相同宽高比不同分辨率的底图，实际导出布局与点位像素坐标一致", () => {
    const plan=emptyPointMapPlan("synthetic")
    plan.floors=[{id:"f",name:"全屋",floorplanName:"base.png",floorplanDataUrl:"",imageWidth:600,imageHeight:400}]
    const a=buildPointMapRenderLayout(plan,"f",{width:600,height:400},{pointsOnly:true})
    const b=buildPointMapRenderLayout(plan,"f",{width:6000,height:4000},{pointsOnly:true})
    expect(a).toEqual(b)
    expect(a.image.width).toBe(3000)
  })
})
