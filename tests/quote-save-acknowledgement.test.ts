import { describe, expect, it } from "vitest"
import { acknowledgeQuotePointChanges, pointMapRevisionForQuote, type QuoteLineItem } from "../lib/quote-authoring"

function draft() {
  const items = [{ lineId: "line", pointMapProjectId: "project-a", pointMapRevision: 8, price: 20 }] as QuoteLineItem[]
  return { projectKey: "project-a", pointMapRevision: 8, items, dirty: true,
    pendingPointRemovals: ["gone"], pendingPointRoomMoves: [{ pointIds: ["point"], room: "一楼 / 书房" }] }
}
describe("quote acknowledgement after linked point-map writes", () => {
  it("advances all surviving source rows and clears only the submitted changes", () => {
    const submitted = draft()
    const nextMove = { pointIds: ["point"], room: "一楼 / 客厅" }
    const current = { ...submitted, items: [{ ...submitted.items[0], price: 99 }], pendingPointRemovals: ["gone", "later"], pendingPointRoomMoves: [...submitted.pendingPointRoomMoves, nextMove] }
    const acknowledged = acknowledgeQuotePointChanges(current, submitted, 9)
    expect(acknowledged).toMatchObject({ pointMapRevision: 9, dirty: true, pendingPointRemovals: ["later"], pendingPointRoomMoves: [nextMove], items: [{ price: 99, pointMapRevision: 9 }] })
    expect(submitted.items[0].pointMapRevision).toBe(8)
  })
  it("does not acknowledge into another project or replace a newer imported revision", () => {
    const submitted = draft()
    const other = { ...submitted, projectKey: "project-b" }
    expect(acknowledgeQuotePointChanges(other, submitted, 9)).toBe(other)
    expect(acknowledgeQuotePointChanges({ ...submitted, pointMapRevision: 10 }, submitted, 9).pointMapRevision).toBe(10)
  })
  it("recovers one source revision on reload and rejects mixed or missing provenance", () => {
    const { items } = draft()
    expect(pointMapRevisionForQuote(items)).toBe(8)
    expect(pointMapRevisionForQuote([...items, { ...items[0], pointMapRevision: 9 }])).toBeUndefined()
    expect(pointMapRevisionForQuote([{ ...items[0], pointMapRevision: undefined }])).toBeUndefined()
    expect(pointMapRevisionForQuote([])).toBeUndefined()
  })
})
