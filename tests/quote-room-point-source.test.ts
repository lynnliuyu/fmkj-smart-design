import { describe, expect, it } from "vitest"
import { deleteQuoteRoom, renameQuoteRoom } from "../lib/quote-room-management"

const manual = { id: "m", room: "健身房" }
const sourced = { id: "s", room: "一楼 / 客厅", pointMapProjectId: "p", pointIds: ["point-1"] }

describe("room delete and rename with point-sourced rows", () => {
  it("deletes sourced rows and returns their point IDs for the atomic save", () => {
    const result = deleteQuoteRoom(["一楼 / 客厅"], [sourced], "一楼 / 客厅")
    expect(result.blocked).toBe(false)
    expect(result.items).toEqual([])
    expect(result.removedPointIds).toEqual(["point-1"])
  })

  it("blocks renaming a room that holds point-sourced rows", () => {
    const result = renameQuoteRoom(["一楼 / 客厅"], [sourced], "一楼 / 客厅", "一楼 / 起居室")
    expect(result.blocked).toBe(true)
    expect(result.changed).toBe(false)
  })

  it("still deletes a manual room and moves its rows", () => {
    const result = deleteQuoteRoom(["健身房", "客厅"], [manual], "健身房")
    expect(result.blocked).toBe(false)
    expect(result.items[0].room).toBe("客厅")
  })
})
