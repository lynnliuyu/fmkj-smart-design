import { describe, expect, it } from "vitest"
import { groupPointMapEditorMarkers, focusPointMapEditorView } from "../lib/point-map-editor-view"
import { pointMapEditorGeometry } from "../lib/point-map-image-size.mjs"
const geometry=pointMapEditorGeometry({width:3000,height:2000},{width:640,height:480})

describe("工作台屏幕分组与局部定位",()=>{
  it("靠近的开关按屏幕距离分组，放大后分开，不合并数据",()=>{
    const points=Object.freeze([Object.freeze({id:"a",x:40,y:40}),Object.freeze({id:"b",x:42,y:40}),Object.freeze({id:"c",x:80,y:80})])
    const all=groupPointMapEditorMarkers(points,geometry,1)
    expect(all.map(g=>g.pointIds)).toEqual([["a","b"],["c"]])
    expect(groupPointMapEditorMarkers(points,geometry,8)).toHaveLength(3)
    expect(points.map(p=>p.x)).toEqual([40,42,80])
    expect(groupPointMapEditorMarkers([...points].reverse(),geometry,1)).toEqual(all)
  })
  it("密集点位的链式相邻不能把整屋串成一个大组",()=>{
    const points=Array.from({length:7},(_,i)=>({id:String(i),x:10+i*4,y:50}))
    const groups=groupPointMapEditorMarkers(points,geometry,1)
    expect(groups.length).toBeGreaterThanOrEqual(3)
    for(const group of groups){
      const x=points.filter(p=>group.pointIds.includes(p.id)).map(p=>p.x/100*geometry.width*geometry.fitScale)
      expect(Math.max(...x)-Math.min(...x)).toBeLessThanOrEqual(44)
    }
  })
  it("选中点可以从完全重合的组中独立取出并拖动，其他点仍可选择",()=>{
    const points=[{id:"a",x:50,y:50},{id:"b",x:50,y:50},{id:"c",x:50,y:50}]
    expect(groupPointMapEditorMarkers(points,geometry,16).map(g=>g.pointIds)).toEqual([["a","b","c"]])
    expect(groupPointMapEditorMarkers(points,geometry,16,"a").map(g=>g.pointIds)).toEqual([["a"],["b","c"]])
  })
  it("局部定位只移动相机，并让目标处于画布中心",()=>{
    const p={x:80,y:20}
    const camera=focusPointMapEditorView(geometry,[p],{width:640,height:480},1)
    expect(camera.zoom).toBeGreaterThan(1)
    expect(camera.pan.x+(p.x-50)/100*geometry.width*geometry.fitScale*camera.zoom).toBeCloseTo(0)
    expect(camera.pan.y+(p.y-50)/100*geometry.height*geometry.fitScale*camera.zoom).toBeCloseTo(0)
    expect(p).toEqual({x:80,y:20})
  })
})
