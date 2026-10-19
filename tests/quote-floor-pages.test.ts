import { describe, expect, it } from "vitest"
import { floorOfRoom, quoteFloorPages, UNASSIGNED_FLOOR_PAGE } from "../lib/quote-authoring"

describe("quote floor pages", () => {
  it("reads the floor from a point-map room label", () => {
    expect(floorOfRoom("一楼 / 次卧1")).toBe("一楼")
  })

  it("puts manual rows without a floor prefix on the unassigned page", () => {
    expect(floorOfRoom("客厅")).toBe(UNASSIGNED_FLOOR_PAGE)
  })

  it("lists floors in order of appearance with unassigned last", () => {
    const pages = quoteFloorPages([{ room: "客厅" }, { room: "二楼 / 主卧" }, { room: "一楼 / 餐厅" }, { room: "二楼 / 书房" }])
    expect(pages).toEqual(["二楼", "一楼", UNASSIGNED_FLOOR_PAGE])
  })

  it("returns no pages for an empty quote", () => {
    expect(quoteFloorPages([])).toEqual([])
  })
})
