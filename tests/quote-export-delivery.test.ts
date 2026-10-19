import { describe, expect, it, vi } from "vitest"
import { prepareProjectDeliveryOutput, prepareQuoteExportSource } from "../lib/project-delivery-client"
import type { ProjectDeliverySnapshot } from "../lib/project-delivery"
import type { SavedQuoteExportSnapshot } from "../lib/quote-authoring"

const projectId = "11111111-1111-4111-8111-111111111111"
function snapshot(): SavedQuoteExportSnapshot {
  return { quoteNo: "QT-PURE", status: "草稿", subtotal: 10.25, discountTotal: 0.2, total: 15.38, installationFee: 5.33,
    items: [{ lineId: "saved-1", id: "sku-1", name: "独立报价产品", spec: "", unit: "个", category: "其他", image: "/saved.png", cost: 0, price: 10.25, quantity: 1, discount: 98.04878048780488, room: "全屋" }], groups: [] }
}
function response(body: unknown, status = 200) { return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) }

describe("quote-only export boundary", () => {
  it("never regenerates selected history while preparing any customer output", async () => {
    const historical = { id: "version-id", version: 4, project: { id: projectId }, quote: { quoteNo: "QT-ISSUED", total: 15.38 } } as ProjectDeliverySnapshot
    const fetcher = vi.fn<typeof fetch>()
    expect(await prepareProjectDeliveryOutput(projectId, historical, fetcher)).toBe(historical)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(prepareProjectDeliveryOutput("another-project", historical, fetcher)).rejects.toThrow("项目或版本")
  })
  it("turns a saved-data preview into a fixed version before an output", async () => {
    const delivery = { id: "version-id", version: 5, project: { id: projectId }, quote: { quoteNo: "QT-SAVED", total: 15.38 } }
    const fetcher = response({ data: delivery })
    expect(await prepareProjectDeliveryOutput(projectId, { version: 0 } as ProjectDeliverySnapshot, fetcher)).toEqual(delivery)
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(prepareProjectDeliveryOutput(projectId, undefined, response({ data: { ...delivery, id: null, version: 0 } }))).rejects.toThrow("版本信息不完整")
  })
  it("uses one fixed delivery for a project with a point map", async () => {
    const delivery = { id: "version-id", version: 4, project: { id: projectId }, quote: { quoteNo: "QT-SAVED", total: 15.38 } }
    const fetcher = response({ data: delivery })
    expect(await prepareQuoteExportSource({ projectId, snapshot: snapshot(), fetcher })).toEqual({ kind: "delivery", delivery })
    expect(fetcher).toHaveBeenCalledWith(`/api/projects/${projectId}/deliveries`, { method: "POST", cache: "no-store" })
  })

  it("retains the saved quote snapshot and decimal total only on explicit no-plan response", async () => {
    const saved = snapshot()
    const result = await prepareQuoteExportSource({ projectId, snapshot: saved, fetcher: response({ code: "DELIVERY_PLAN_REQUIRED", error: "无方案" }, 409) })
    expect(result).toEqual({ kind: "quote", snapshot: saved })
    if (result.kind === "quote") { expect(result.snapshot).toBe(saved); expect(result.snapshot.total).toBe(15.38) }
  })

  it.each([
    [{ pointMapProjectId: projectId }],
    [{ pointIds: ["point-1"] }],
  ])("does not drop point-source provenance when a plan is missing", async (source) => {
    const saved = snapshot(); Object.assign(saved.items[0], source)
    await expect(prepareQuoteExportSource({ projectId, snapshot: saved, fetcher: response({ code: "DELIVERY_PLAN_REQUIRED" }, 409) })).rejects.toThrow("报价仍关联点位来源")
  })

  it.each([
    [403, { code: "POINT_MAP_NOT_INCLUDED" }],
    [403, { code: "DELIVERY_PLAN_REQUIRED" }],
    [401, { error: "NOT_AUTHENTICATED" }],
    [404, { error: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" }],
    [409, { code: "DELIVERY_SOURCE_CONFLICT", issues: ["K01 数量不对应"] }],
    [503, { error: "DATABASE_UNAVAILABLE" }],
    [200, { data: { project: { id: "another-project" }, quote: {} } }],
  ])("never falls back on status %s without a verified no-plan result", async (status, body) => {
    await expect(prepareQuoteExportSource({ projectId, snapshot: snapshot(), fetcher: response(body, status) })).rejects.toThrow()
  })

  it("retains validation details and stops on network/JSON failures", async () => {
    await expect(prepareQuoteExportSource({ projectId, snapshot: snapshot(), fetcher: response({ code: "DELIVERY_SOURCE_CONFLICT", issues: ["K01 数量不对应"] }, 409) })).rejects.toThrow("K01 数量不对应")
    await expect(prepareQuoteExportSource({ projectId, snapshot: snapshot(), fetcher: vi.fn(async () => { throw new Error("network failed") }) })).rejects.toThrow("network failed")
    await expect(prepareQuoteExportSource({ projectId, snapshot: snapshot(), fetcher: vi.fn(async () => new Response("not JSON", { status: 409 })) })).rejects.toThrow()
  })
})
