import { describe, expect, it } from "vitest"

import { pointMapStorageKey, readPointMapPlan, type PointMapStorage } from "../lib/point-map-plan.js"
import {
  addQuoteProductSelection,
  addQuoteProductToPlan,
  createQuoteLine,
  resolveQuoteProjectKey,
} from "../lib/quote-point-map-command.js"

class MemoryStorage implements PointMapStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const product = {
  deviceTypeId: "wireless-ap",
  specs: { power: "poe", wireless_standard: "wifi6" },
  category: "网络覆盖",
  cost: 100,
  id: "ap_1",
  image: "/ap.png",
  name: "Wi-Fi 6 面板 AP",
  price: 199,
  spec: "PoE",
  unit: "个",
}

describe("quote point map command", () => {
  it("adds a quote product selection through the project reference interface", async () => {
    const storage = new MemoryStorage()
    const result = await addQuoteProductSelection({
      createLineId: () => "line_1",
      product,
      project: {
        id: "",
        name: "project_from_name",
      },
      quantity: 2,
      room: "涔︽埧",
      storage,
    })
    const plan = readPointMapPlan("project_from_name", storage)

    expect(result).toMatchObject({
      line: {
        lineId: "line_1",
        quantity: 2,
      },
      pointMapProjectId: "project_from_name",
      pointMapQueued: true,
    })
    expect(plan.points).toHaveLength(2)
  })

  it("creates a quote line and queues matching point map nodes", async () => {
    const storage = new MemoryStorage()
    const result = await addQuoteProductToPlan({
      createLineId: () => "line_1",
      product,
      projectId: "project_1",
      quantity: 2,
      room: "书房",
      storage,
    })
    const plan = readPointMapPlan("project_1", storage)

    expect(result).toMatchObject({
      line: {
        discount: 100,
        lineId: "line_1",
        quantity: 2,
        room: "书房",
      },
      pointMapProjectId: "project_1",
      pointMapQueued: true,
    })
    expect(plan.points).toHaveLength(2)
    expect(plan.points[0]).toMatchObject({
      iconId: "ap",
      placed: false,
      productId: "ap_1",
      room: "书房",
      status: "pending",
    })
  })

  it("can create a quote line without point map synchronization", async () => {
    const storage = new MemoryStorage()
    const result = await addQuoteProductToPlan({
      createLineId: () => "line_1",
      product,
      projectId: "project_1",
      room: "书房",
      storage,
      syncPointMap: false,
    })

    expect(result.pointMapQueued).toBe(false)
    expect(storage.getItem(pointMapStorageKey("project_1"))).toBeNull()
  })

  it("preserves decimal material quantities and normalizes discount", () => {
    const line = createQuoteLine(product, "客厅", {
      createLineId: () => "line_2",
      discount: 150,
      quantity: 2.6,
    })

    expect(line).toMatchObject({
      discount: 100,
      lineId: "line_2",
      quantity: 2.6,
      room: "客厅",
    })
  })

  it("resolves quote project identity without leaking fallback logic to callers", () => {
    expect(resolveQuoteProjectKey({ id: "project_1", name: "Project One" })).toBe("project_1")
    expect(resolveQuoteProjectKey({ id: "", name: "Project One" })).toBe("Project One")
    expect(resolveQuoteProjectKey({ id: null, name: null })).toBe("")
  })
})
