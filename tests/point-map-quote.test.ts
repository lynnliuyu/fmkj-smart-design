import { describe, expect, it } from "vitest"

import { applyPointMapQuoteSnapshot, mergeQuoteDraftLoad, quoteItemsSavePayload, type QuoteLineItem, type SavedQuoteItem } from "../lib/quote-authoring"
import { consumePointMapQuoteSnapshot, consumeQuoteDraftItems, POINT_MAP_QUOTE_SNAPSHOT_PREFIX, QUOTE_DRAFT_STORAGE_KEY, writePointMapQuoteSnapshot, type PointMapQuoteSnapshot, type QuoteDraftItem, type QuoteDraftProduct } from "../lib/quote-draft"
import type { PointMapStorage } from "../lib/point-map-plan"
import { saveQuoteDraft } from "../lib/quote-save"

const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222"
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333"
const product: QuoteDraftProduct = { id: PRODUCT_ID, name: "Synthetic panel", category: "开关", spec: "双键", image: "/placeholder.svg", cost: 100, price: 200, unit: "个" }

class MemoryStorage implements PointMapStorage {
  readonly data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

function line(patch: Partial<QuoteLineItem> = {}): QuoteLineItem {
  return { ...product, lineId: "manual", room: "一楼 / 客厅", quantity: 5, discount: 90, ...patch }
}

function draftItem(patch: Partial<QuoteDraftItem> = {}): QuoteDraftItem {
  return { ...product, project: "Synthetic project", projectId: PROJECT_ID, room: "一楼 / 客厅", quantity: 1, pointMapProjectId: PROJECT_ID, pointIds: ["g1"], ...patch }
}

function savedItem(patch: Partial<SavedQuoteItem> = {}): SavedQuoteItem {
  return { ...product, room: "一楼 / 客厅", quantity: 5, discount: 90, ...patch }
}

function snapshot(items: QuoteDraftItem[] = [draftItem()]): PointMapQuoteSnapshot {
  return { projectId: PROJECT_ID, items }
}

describe("point-map quote synchronization", () => {
  it("replaces its own previous quantities without accumulating or replacing a manual same-product line", () => {
    const storage = new MemoryStorage()
    const manual = line()
    writePointMapQuoteSnapshot(snapshot([
      draftItem({ quantity: 2, pointIds: ["g1", "g2"] }),
      draftItem({ room: "负一楼 / 客厅", pointIds: ["b1"] }),
    ]), storage)
    const first = applyPointMapQuoteSnapshot([manual], consumePointMapQuoteSnapshot(PROJECT_ID, storage)!)
    first.find((item) => item.pointMapProjectId === PROJECT_ID)!.discount = 80
    writePointMapQuoteSnapshot(snapshot([
      draftItem({ quantity: 2, pointIds: ["g1", "g2"] }),
      draftItem({ room: "负一楼 / 客厅", pointIds: ["b1"] }),
    ]), storage)
    const second = applyPointMapQuoteSnapshot(first, consumePointMapQuoteSnapshot(PROJECT_ID, storage)!)
    expect(second).toHaveLength(3)
    expect(second[0]).toEqual(manual)
    expect(second.filter((item) => item.pointMapProjectId === PROJECT_ID).map((item) => item.quantity)).toEqual([2, 1])
    expect(second[1].discount).toBe(80)
    expect(second.map((item) => item.lineId)).toEqual(first.map((item) => item.lineId))
  })

  it("consumes an empty snapshot to remove old point-map rows and preserves manual and unrelated origins", () => {
    const storage = new MemoryStorage()
    const manual = line()
    const other = line({ lineId: "other-source", pointMapProjectId: OTHER_PROJECT_ID, pointIds: ["other-point"] })
    const current = applyPointMapQuoteSnapshot([manual, other], snapshot())
    writePointMapQuoteSnapshot(snapshot([]), storage)
    const empty = consumePointMapQuoteSnapshot(PROJECT_ID, storage)
    expect(empty).toEqual({ projectId: PROJECT_ID, items: [] })
    expect(applyPointMapQuoteSnapshot(current, empty!)).toEqual([manual, other])
  })

  it("consumes only the selected project and leaves other project queued drafts intact", () => {
    const storage = new MemoryStorage()
    const mine = draftItem({ pointMapProjectId: undefined })
    const other = draftItem({ projectId: OTHER_PROJECT_ID, project: "Other", pointMapProjectId: undefined })
    const legacyMine = draftItem({ projectId: undefined, project: "Synthetic project", pointMapProjectId: undefined })
    const legacyOther = draftItem({ projectId: undefined, project: "Other", pointMapProjectId: undefined })
    storage.setItem(QUOTE_DRAFT_STORAGE_KEY, JSON.stringify([mine, other, legacyMine, legacyOther]))
    expect(consumeQuoteDraftItems({ projectId: PROJECT_ID, projectName: "Synthetic project", storage })).toEqual([mine, legacyMine])
    expect(JSON.parse(storage.getItem(QUOTE_DRAFT_STORAGE_KEY)!)).toEqual([other, legacyOther])
    storage.setItem(POINT_MAP_QUOTE_SNAPSHOT_PREFIX + OTHER_PROJECT_ID, JSON.stringify({ projectId: OTHER_PROJECT_ID, items: [] }))
    expect(consumePointMapQuoteSnapshot(PROJECT_ID, storage)).toBeNull()
    expect(storage.getItem(POINT_MAP_QUOTE_SNAPSHOT_PREFIX + OTHER_PROJECT_ID)).not.toBe("")
  })

  it("keeps a mismatched snapshot unconsumed rather than charging it to the selected project", () => {
    const storage = new MemoryStorage()
    const value = JSON.stringify({ projectId: OTHER_PROJECT_ID, items: [] })
    storage.setItem(POINT_MAP_QUOTE_SNAPSHOT_PREFIX + PROJECT_ID, value)
    expect(consumePointMapQuoteSnapshot(PROJECT_ID, storage)).toBeNull()
    expect(storage.getItem(POINT_MAP_QUOTE_SNAPSHOT_PREFIX + PROJECT_ID)).toBe(value)
  })
})

describe("quote cloud load and point-map imports", () => {
  it("merges imported points after the cloud base and preserves newly added items while the request was pending", () => {
    const cloud: SavedQuoteItem[] = [savedItem(), savedItem({ pointMapProjectId: PROJECT_ID, pointIds: ["old"], quantity: 99 })]
    const newManual = line({ lineId: "new-local", quantity: 3, room: "书房" })
    const result = mergeQuoteDraftLoad({ savedItems: cloud, localItemsAtStart: [], localItemsNow: [newManual], pointMapSnapshot: snapshot([draftItem({ quantity: 2, pointIds: ["g1", "g2"] })]) })
    expect(result).toHaveLength(3)
    expect(result.find((item) => item.pointMapProjectId === PROJECT_ID)).toMatchObject({ quantity: 2, pointIds: ["g1", "g2"] })
    expect(result.find((item) => item.lineId === "new-local")).toEqual(newManual)
    expect(result.filter((item) => !item.pointMapProjectId).map((item) => item.quantity)).toEqual([5, 3])
  })

  it("applies empty imported snapshots after saved data so removed devices do not reappear", () => {
    const cloud = [line(), line({ pointMapProjectId: PROJECT_ID, pointIds: ["deleted"] })]
    const result = mergeQuoteDraftLoad({ savedItems: cloud, localItemsAtStart: [], localItemsNow: [], pointMapSnapshot: snapshot([]) })
    expect(result).toHaveLength(1)
    expect(result[0].pointMapProjectId).toBeUndefined()
  })

  it("does not revive an empty snapshot's deleted source when that row was edited during loading", () => {
    const manual = line({ lineId: "manual-same-product" })
    const source = line({ lineId: "deleted-source", pointMapProjectId: PROJECT_ID, pointIds: ["deleted"] })
    const editedManual = { ...manual, price: 170, quantity: 7 }
    const result = mergeQuoteDraftLoad({
      savedItems: [savedItem(), savedItem({ pointMapProjectId: PROJECT_ID, pointIds: ["deleted"] })],
      localItemsAtStart: [manual, source],
      localItemsNow: [editedManual, { ...source, price: 155, discount: 75, quantity: 9 }],
      pointMapSnapshot: snapshot([]),
    })
    expect(result).toEqual([editedManual])
  })

  it("keeps snapshot quantities and point IDs authoritative while preserving pending price edits", () => {
    const manual = line({ lineId: "manual-same-product" })
    const kept = line({ lineId: "kept-source", pointMapProjectId: PROJECT_ID, pointIds: ["old"], quantity: 5 })
    const deleted = line({ lineId: "deleted-source", room: "负一楼 / 客厅", pointMapProjectId: PROJECT_ID, pointIds: ["deleted"] })
    const result = mergeQuoteDraftLoad({
      savedItems: [savedItem(), savedItem({ pointMapProjectId: PROJECT_ID, pointIds: ["old"] }), savedItem({ room: "负一楼 / 客厅", pointMapProjectId: PROJECT_ID, pointIds: ["deleted"] })],
      localItemsAtStart: [manual, kept, deleted],
      localItemsNow: [manual, { ...kept, quantity: 99, pointIds: ["obsolete"], price: 155, discount: 75 }, { ...deleted, discount: 60 }],
      pointMapSnapshot: snapshot([draftItem({ quantity: 2, pointIds: ["g1", "g2"] })]),
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(manual)
    expect(result[1]).toMatchObject({ lineId: "kept-source", quantity: 2, pointIds: ["g1", "g2"], price: 155, discount: 75, pointMapProjectId: PROJECT_ID })
  })

  it("preserves edits and deletions made to visible lines during a pending reload", () => {
    const cloud = [line(), line({ id: "second-product", room: "卧室" })]
    const baseline = mergeQuoteDraftLoad({ savedItems: cloud, localItemsAtStart: [], localItemsNow: [] })
    const edited = { ...baseline[0], quantity: 8, price: 155, discount: 75 }
    const result = mergeQuoteDraftLoad({ savedItems: cloud, localItemsAtStart: baseline, localItemsNow: [edited] })
    expect(result).toEqual([edited])
  })

  it("retains unsaved cached project edits instead of replacing them on a project-switch reload", () => {
    const local = line({ quantity: 8 })
    const result = mergeQuoteDraftLoad({ savedItems: [line({ quantity: 1 })], preserveLocalDraft: true, localItemsAtStart: [local], localItemsNow: [local] })
    expect(result).toEqual([local])
  })

  it("matches saved rows back to original local line IDs so a pending edit cannot duplicate the saved product", () => {
    const manual = line({ lineId: "newly-added-local-id" })
    const source = line({ lineId: "point-map:original-id", pointMapProjectId: PROJECT_ID, pointIds: ["g1"] })
    const current = [manual, { ...source, discount: 65 }]
    const result = mergeQuoteDraftLoad({ savedItems: [savedItem(), savedItem({ pointMapProjectId: PROJECT_ID, pointIds: ["g1"] })], localItemsAtStart: [manual, source], localItemsNow: current })
    expect(result).toEqual(current)
    expect(result).toHaveLength(2)
  })

  it("preserves room changes made before cloud items finish loading", () => {
    const result = mergeQuoteDraftLoad({ savedItems: [line()], localItemsAtStart: [], localItemsNow: [], roomChanges: [{ from: "一楼 / 客厅", to: "一楼 / 起居室" }] })
    expect(result[0].room).toBe("一楼 / 起居室")
  })

  it("preserves legacy manual queued items while applying the point-map origin replacement", () => {
    const manual = draftItem({ pointMapProjectId: undefined, pointIds: undefined, quantity: 4 })
    const result = mergeQuoteDraftLoad({ savedItems: [], localItemsAtStart: [], localItemsNow: [], draftItems: [manual], pointMapSnapshot: snapshot() })
    expect(result).toHaveLength(2)
    expect(result.map((item) => [item.quantity, item.pointMapProjectId])).toEqual([[4, undefined], [1, PROJECT_ID]])
  })
})

describe("quote source save roundtrip", () => {
  it("serializes physical point IDs and keeps manual rows unmarked", () => {
    const manual = line()
    const source = line({ lineId: "source", quantity: 2, pointMapProjectId: PROJECT_ID, pointIds: ["g1", "g2"] })
    const payload = quoteItemsSavePayload([manual, source])
    expect(payload[0]).not.toHaveProperty("pointMapProjectId")
    expect(payload[1]).toMatchObject({ productId: PRODUCT_ID, quantity: 2, pointMapProjectId: PROJECT_ID, pointIds: ["g1", "g2"] })
    payload[1].pointIds!.push("external")
    expect(source.pointIds).toEqual(["g1", "g2"])
  })

  it("rejects another project origin before writing any quote line", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    const client = {
      release() {},
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params })
        if (sql.includes("from projects")) return { rows: [{ id: PROJECT_ID, name: "Synthetic", createdAt: new Date("2026-10-14T00:00:00Z") }] }
        if (sql.includes("from quotes")) return { rows: [] }
        if (sql.includes("insert into quotes")) return { rows: [{ id: OTHER_PROJECT_ID, quote_no: "QT-SYNTHETIC" }] }
        if (sql.includes("insert into activity_logs")) return { rows: [{ id: "event" }] }
        return { rows: [] }
      },
    }
    await expect(saveQuoteDraft({ projectId: PROJECT_ID, items: quoteItemsSavePayload([
      line(), line({ pointMapProjectId: PROJECT_ID, pointIds: ["g1", "g2"] }), line({ pointMapProjectId: OTHER_PROJECT_ID, pointIds: ["other-point"] }),
    ]) }, { db: { connect: async () => client } as never })).rejects.toMatchObject({ status: 400 })
    const writes = calls.filter((call) => call.sql.includes("insert into quote_items"))
    expect(writes).toEqual([])
  })
})
