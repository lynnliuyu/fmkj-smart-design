import { describe, expect, it } from "vitest"
import { pointIdsRemovedByLines, removePointsFromPlan, syncLocalPointDraft } from "../lib/point-map-quote-removal"
import type { PointMapPlan } from "../lib/point-map-plan"

const plan = {
  projectId: "p", floorplanName: "", floorplanDataUrl: "", updatedAt: "",
  points: [
    { id: "a", room: "客厅" }, { id: "b", room: "客厅" }, { id: "c", room: "卧室" },
  ],
  scenes: [{ id: "s", pointIds: ["a", "c"] }],
} as unknown as PointMapPlan

describe("quote removal maps to points", () => {
  it("removing a sourced line removes all its points", () => {
    expect(pointIdsRemovedByLines([{ room: "客厅", pointMapProjectId: "p", pointIds: ["a", "b"] }])).toEqual(["a", "b"])
  })

  it("ignores manual lines", () => {
    expect(pointIdsRemovedByLines([{ room: "客厅", pointIds: ["a"] }])).toEqual([])
  })

  it("removes points and cleans scene references", () => {
    const next = removePointsFromPlan(plan, ["a"])
    expect(next.points.map((p) => p.id)).toEqual(["b", "c"])
    expect(next.scenes?.[0].pointIds).toEqual(["c"])
    expect(next.scenes?.[0].status).toBe("proposed")
  })

  it("retains unrelated scene confirmation and the immutable original", () => {
    const source = { ...plan, scenes: [
      { id: "affected", pointIds: ["a"], status: "confirmed" },
      { id: "unrelated", pointIds: ["c"], status: "confirmed" },
    ] } as unknown as PointMapPlan
    const next = removePointsFromPlan(source, ["a"])
    expect(next.scenes?.[0]).toMatchObject({ pointIds: [], status: "proposed" })
    expect(next.scenes?.[1]).toBe(source.scenes?.[1])
    expect(source.scenes?.[0]).toMatchObject({ pointIds: ["a"], status: "confirmed" })
  })
})

describe("local point-map draft follows quote edits", () => {
  const store = (initial: PointMapPlan | null) => {
    const state = { plan: initial, writes: 0 }
    return { state, read: async () => (state.plan ? { plan: state.plan } : null), write: async (next: PointMapPlan) => { state.plan = next; state.writes++ } }
  }

  it("removes the deleted device from the local draft so it cannot be re-saved", async () => {
    const local = store(plan)
    expect(await syncLocalPointDraft(local, "p", ["a"])).toBe(true)
    expect(local.state.plan?.points.map((point) => point.id)).toEqual(["b", "c"])
  })

  it("applies room moves without the floor prefix", async () => {
    const local = store(plan)
    await syncLocalPointDraft(local, "p", [], [{ pointIds: ["c"], room: "一楼 / 书房" }])
    expect(local.state.plan?.points.find((point) => point.id === "c")?.room).toBe("书房")
  })

  it("does nothing without changes or without a local draft", async () => {
    const local = store(plan)
    expect(await syncLocalPointDraft(local, "p", [])).toBe(false)
    expect(await syncLocalPointDraft(store(null), "p", ["a"])).toBe(false)
    expect(local.state.writes).toBe(0)
  })
})
