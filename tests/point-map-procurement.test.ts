import { describe, expect, it } from "vitest"
import { buildProcurementPreview, type ProcurementProduct } from "../lib/point-map-procurement"
import type { PointMapNode, PointMapPlan } from "../lib/point-map-plan"
import { hydratePlanSelections } from "../lib/point-map-selection-service"
import { applyPointMapQuoteSnapshot, type QuoteLineItem } from "../lib/quote-authoring"

const ID = "11111111-1111-4111-8111-111111111111"
const product: ProcurementProduct = { id: ID, name: "Synthetic three key", sku: "SYN-3N", category: "开关", deviceTypeId: "wall-switch", catalogKind: "sku", specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, protocols: ["ble-mesh"], capabilities: ["load-control"], selectionStatus: "verified", selectionEvidence: "Synthetic validated specification", pricingStatus: "verified", pricingEvidence: "Synthetic supplier price", mappingRevision: 2, status: "active", unit: "个", price: 300, cost: 200, spec: "3 keys / 2 relays", image: "/placeholder.svg" }
const point: PointMapNode = { id: "point-1", name: "Panel", room: "Living", code: "K01", floorId: "ground", iconId: "switch-3", status: "confirmed", x: 20.123456, y: 30.123456, placed: true, productId: ID, deviceTypeId: "wall-switch", requirements: { button_count: 3, relay_count: 2, wiring: "neutral" }, usage: "selected", selection: { productId: ID, mappingRevision: 2, deviceTypeId: "wall-switch", sku: "SYN-3N", name: "Synthetic three key", specs: product.specs!, protocols: [], capabilities: [], unit: "个", manufacturerModel: null, verifiedAt: "2026-10-14T00:00:00Z" }, note: "" }
const plan = (points: PointMapNode[]): PointMapPlan => ({ projectId: ID, schemaVersion: 3, floorplanName: "", floorplanDataUrl: "", floors: [{ id: "ground", name: "一楼", floorplanName: "", floorplanDataUrl: "", imageWidth: 1, imageHeight: 1 }], points, updatedAt: "2026-10-14T00:00:00Z" })

describe("point procurement preview", () => {
  it("counts physical devices while keeping identical room names on different floors separate", () => {
    const multi = plan([point, { ...point, id: "second" }, { ...point, id: "lower", floorId: "basement" }])
    multi.floors!.push({ ...multi.floors![0], id: "basement", name: "负一楼" })
    const result = buildProcurementPreview(multi, 8, [product], "Synthetic")
    expect(result.blocked).toBe(false)
    expect(result.data.items.map(({ room, quantity, pointIds }) => ({ room, quantity, pointIds }))).toEqual([
      { room: "一楼 / Living", quantity: 2, pointIds: ["point-1", "second"] },
      { room: "负一楼 / Living", quantity: 1, pointIds: ["lower"] },
    ])
  })
  it("counts a three key / two relay physical device once and excludes reserve candidates", () => {
    const result = buildProcurementPreview(plan([point, { ...point, id: "reserve", usage: "reserve" }]), 8, [product], "Synthetic")
    expect(result).toMatchObject({ blocked: false, included: 1, excluded: 1, data: { revision: 8, items: [{ quantity: 1, pointIds: ["point-1"], pointMapRevision: 8 }] } })
  })
  it.each([
    { selectionStatus: "pending" as const },
    { pricingStatus: "pending" as const },
    { mappingRevision: 3 },
    { specs: { button_count: 1, relay_count: 1, wiring: "neutral" } },
    { unit: "米" },
    { status: "inactive" },
  ])("blocks whole replacement when a selected product is unavailable or unverified: %j", (patch) => {
    const result = buildProcurementPreview(plan([point]), 8, [{ ...product, ...patch }], "Synthetic")
    expect(result.blocked).toBe(true)
    expect(result.diagnostics[0].pointId).toBe(point.id)
    expect(result.data.items).toEqual([])
  })
  it("keeps hand edited price, cost and discount when synchronizing quantities again", () => {
    const manual: QuoteLineItem = { ...product, lineId: "line", room: "一楼 / Living", quantity: 4, price: 325, cost: 201, discount: 88, pointMapProjectId: ID, pointIds: [point.id] }
    const result = applyPointMapQuoteSnapshot([manual], buildProcurementPreview(plan([point]), 8, [product], "Synthetic").data)
    expect(result[0]).toMatchObject({ quantity: 1, price: 325, cost: 201, discount: 88, pointMapRevision: 8 })
  })
  it("does not silently renew a stale selection snapshot on repeated saves", async () => {
    const raw = { id: ID, name: product.name, sku: product.sku, unit: product.unit, category: "开关", brand: "其他", platform: "米家", status: "active", cost: 200, price: 300, created_at: new Date(), updated_at: new Date(), catalog_kind: "sku", device_type_id: "wall-switch", specs: product.specs, protocols: [], capabilities: [], selection_status: "verified", selection_evidence: "Synthetic evidence", pricing_status: "verified", pricing_evidence: "Synthetic price", mapping_revision: 3 }
    const client = { query: async () => ({ rows: [raw] }) } as never
    const first = await hydratePlanSelections(client, plan([point]), ID, plan([point]))
    const second = await hydratePlanSelections(client, first, ID, first)
    expect(second.points[0].selection?.mappingRevision).toBe(2)
    expect(buildProcurementPreview(second, 9, [{ ...product, mappingRevision: 3 }], "Synthetic").blocked).toBe(true)
  })
  it("lists the rooms the point map actually uses, without duplicating a floor prefix", () => {
    const points: PointMapNode[] = [
      { ...point, id: "a", room: "Living" },
      { ...point, id: "b", room: "一楼 / Living" }, // 存量数据：房间名里已经带了楼层
      { ...point, id: "c", room: "Kitchen", floorId: "ground" },
      { ...point, id: "d", room: "", floorId: "ground" },
    ]
    const rooms = buildProcurementPreview(plan(points), 10, [product], "Synthetic").data.rooms
    // 「一楼 / Living」不重复拼楼层；没前缀的 Kitchen 补上楼层；空房间丢掉。
    expect(rooms).toEqual(["一楼 / Living", "一楼 / Kitchen"])
  })
  it("creates a server snapshot for an explicit compatible selection and ignores forged identity", async () => {
    const raw = { id: ID, name: product.name, sku: product.sku, unit: product.unit, category: "开关", status: "active", created_at: new Date(), updated_at: new Date(), catalog_kind: "sku", device_type_id: "wall-switch", specs: product.specs, protocols: [], capabilities: [], selection_status: "verified", selection_evidence: "Synthetic evidence", pricing_status: "verified", pricing_evidence: "Synthetic price", mapping_revision: 2 }
    const client = { query: async () => ({ rows: [raw] }) } as never
    const saved = await hydratePlanSelections(client, plan([{ ...point, selection: undefined }]), ID)
    expect(saved.points[0].selection).toMatchObject({ productId: ID, sku: "SYN-3N", mappingRevision: 2, verifiedBy: ID })
    expect(saved.points[0].x).toBe(20.123456)
  })
})
