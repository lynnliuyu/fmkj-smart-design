import { describe, expect, it } from "vitest"
import { floorRoomOptions, nextFloorRooms, normalizeRoomName } from "../lib/point-map-rooms"
import type { PointMapFloor, PointMapNode } from "../lib/point-map-plan"

const point = (id: string, room: string, floorId: string) =>
  ({ id, room, floorId }) as PointMapNode

const villaFloor: PointMapFloor = {
  id: "villa-1",
  name: "一层",
  floorplanName: "",
  floorplanDataUrl: "",
  imageWidth: 0,
  imageHeight: 0,
}

describe("floorRoomOptions", () => {
  it("uses the default rooms for the property type when the floor has no saved list", () => {
    const rooms = floorRoomOptions({ propertyType: "villa", floor: villaFloor, points: [] })
    expect(rooms).toEqual(["玄关", "客厅", "餐厅", "厨房", "卫生间", "老人房", "阳台"])
  })

  it("prefers the floor's saved room list over the defaults", () => {
    const floor = { ...villaFloor, rooms: ["客厅", "健身房"] }
    expect(floorRoomOptions({ propertyType: "villa", floor, points: [] })).toEqual(["客厅", "健身房"])
  })

  it("keeps rooms already used by points on that floor selectable", () => {
    const floor = { ...villaFloor, rooms: ["客厅"] }
    const points = [point("p1", "旧房间", "villa-1"), point("p2", "客厅", "villa-1"), point("p3", "车库", "villa-basement")]
    expect(floorRoomOptions({ propertyType: "villa", floor, points })).toEqual(["客厅", "旧房间"])
  })

  it("does not pull points from other floors into this floor's options", () => {
    const points = [point("p1", "车库", "villa-basement")]
    expect(floorRoomOptions({ propertyType: "villa", floor: villaFloor, points })).not.toContain("车库")
  })

  it("falls back to the flat default list when property type is unknown", () => {
    expect(floorRoomOptions({ propertyType: null, floor: undefined, points: [] })).toContain("客厅")
  })
})

describe("nextFloorRooms", () => {
  it("appends a trimmed room name", () => {
    expect(nextFloorRooms(["客厅"], "  健身房  ")).toEqual(["客厅", "健身房"])
  })

  it("does not duplicate an existing room", () => {
    expect(nextFloorRooms(["客厅", "健身房"], "健身房")).toEqual(["客厅", "健身房"])
  })

  it("rejects empty names", () => {
    expect(() => nextFloorRooms(["客厅"], "   ")).toThrow("房间名称不能为空")
  })

  it("rejects names over the length limit", () => {
    expect(() => nextFloorRooms([], "房".repeat(257))).toThrow("不能超过 256 个字符")
  })
})

describe("normalizeRoomName", () => {
  it("collapses inner whitespace", () => {
    expect(normalizeRoomName(" 主   卧 ")).toBe("主 卧")
  })
})
