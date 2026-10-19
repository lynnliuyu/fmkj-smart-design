import { describe, expect, it } from "vitest"

import {
  addPointToPlan,
  emptyPointMapPlan,
  mapProductToPointIcon,
  movePointInPlan,
  patchPointInPlan,
  pointMapStorageKey,
  queueProductPoints,
  readPointMapPlan,
  removePointFromPlan,
  summarizePointMapRooms,
  writePointMapPlan,
  type PointMapPlan,
  type PointMapStorage,
} from "../lib/point-map-plan.js"

class MemoryPointMapStorage implements PointMapStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const fixedNow = () => "2026-06-28T09:00:00.000Z"

function createIdSequence(prefix = "point") {
  let index = 0
  return () => `${prefix}_${++index}`
}

describe("point map plan", () => {
  it("creates an empty plan with stable project ownership", () => {
    const plan = emptyPointMapPlan("project_1", fixedNow)

    expect(plan).toEqual({
      floorplanDataUrl: "",
      floorplanName: "",
      points: [],
      projectId: "project_1",
      updatedAt: fixedNow(),
    })
  })

  it("reads and normalizes legacy stored point data", () => {
    const storage = new MemoryPointMapStorage()
    storage.setItem(
      pointMapStorageKey("project_1"),
      JSON.stringify({
        projectId: "project_1",
        points: [
          {
            id: "legacy_1",
            kind: "camera",
            name: "",
            room: "",
            status: "unexpected",
            x: Number.NaN,
            y: "bad",
          },
        ],
      })
    )

    const plan = readPointMapPlan("project_1", storage, {
      createId: createIdSequence("generated"),
      now: fixedNow,
    })

    expect(plan.points[0]).toMatchObject({
      iconId: "camera",
      id: "legacy_1",
      placed: true,
      productId: "",
      room: "未分配",
      status: "planned",
      x: 50,
      y: 50,
    })
  })

  it("adds, patches, moves, and removes points through plan commands", () => {
    const base = emptyPointMapPlan("project_1", () => "2026-06-28T09:00:00.000Z")
    const added = addPointToPlan(
      base,
      {
        iconId: "switch-1",
        position: { x: 12.5, y: 30 },
        productId: "product_1",
        room: "客厅",
      },
      { createId: createIdSequence(), now: () => "2026-06-28T09:10:00.000Z" }
    )

    expect(added.point).toMatchObject({
      id: "point_1",
      placed: true,
      productId: "product_1",
      room: "客厅",
      status: "planned",
      x: 12.5,
      y: 30,
    })

    const patched = patchPointInPlan(
      added.plan,
      "point_1",
      { note: "安装高度 1.2m", status: "confirmed" },
      { now: () => "2026-06-28T09:20:00.000Z" }
    )
    const moved = movePointInPlan(patched, "point_1", { x: 70, y: 65 }, { now: () => "2026-06-28T09:30:00.000Z" })
    const removed = removePointFromPlan(moved, "point_1", { now: () => "2026-06-28T09:40:00.000Z" })

    expect(patched.points[0]).toMatchObject({ note: "安装高度 1.2m", status: "confirmed" })
    expect(moved.points[0]).toMatchObject({ x: 70, y: 65 })
    expect(removed.points).toEqual([])
    expect(removed.updatedAt).toBe("2026-06-28T09:40:00.000Z")
  })

  it("queues quote products as pending point map nodes", () => {
    const plan = emptyPointMapPlan("project_1", fixedNow)
    const result = queueProductPoints(
      plan,
      {
        product: {
          category: "网络覆盖",
          cost: 100,
          id: "ap_1",
          deviceTypeId: "wireless-ap",
          image: "/ap.png",
          name: "Wi-Fi 6 面板 AP",
          price: 199,
          spec: "PoE",
          unit: "个",
        },
        projectId: "project_1",
        quantity: 2,
        room: "书房",
      },
      { createId: createIdSequence("queued"), now: fixedNow }
    )

    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toMatchObject({
      iconId: "ap",
      id: "queued_1",
      placed: false,
      productId: "ap_1",
      room: "书房",
      status: "pending",
      x: 50,
      y: 50,
    })
  })

  it("persists plans through the storage adapter", () => {
    const storage = new MemoryPointMapStorage()
    const plan: PointMapPlan = {
      ...emptyPointMapPlan("project_1", fixedNow),
      floorplanName: "户型图.png",
    }

    writePointMapPlan(plan, storage)

    expect(readPointMapPlan("project_1", storage, { now: fixedNow })).toMatchObject({
      floorplanName: "户型图.png",
      projectId: "project_1",
    })
  })

  it("maps product copy and summarizes room progress", () => {
    expect(
      mapProductToPointIcon({
        category: "智能面板",
        cost: 10,
        id: "switch_4",
        deviceTypeId: "wall-switch",
        specs: { button_count: 4 },
        image: "/switch.png",
        name: "四键智能开关",
        price: 20,
        spec: "零火通用",
        unit: "个",
      })
    ).toBe("switch-4")

    expect(
      summarizePointMapRooms([
        { iconId: "switch-1", id: "a", name: "a", note: "", placed: true, productId: "", room: "客厅", status: "confirmed", x: 1, y: 1 },
        { iconId: "sensor", id: "b", name: "b", note: "", placed: true, productId: "", room: "客厅", status: "planned", x: 1, y: 1 },
      ])
    ).toEqual([{ confirmed: 1, room: "客厅", total: 2 }])
  })
})
