import { describe, expect, it, vi } from "vitest"

import { prepareSavedQuoteExport, type SavedQuoteResponse } from "../lib/quote-authoring"

function savedQuote(): SavedQuoteResponse {
  return { data: {
    quoteNo: "QT-SAVED-1", status: "draft", subtotal: 200, discount: 10, total: 240, installationFee: 50,
    rooms: ["一楼 / 客厅"],
    items: [{ id: "saved-product", name: "双键开关", category: "开关", spec: "双键", unit: "个", price: 100, cost: 20, quantity: 2, discount: 95, image: "/saved-product.png", room: "一楼 / 客厅", pointMapProjectId: "project-1", pointIds: ["point-1", "point-2"] }],
  } }
}

describe("saved quote export snapshot", () => {
  it("finishes saving before reading one server result for photos, details, amounts and quote number", async () => {
    let finishSave!: (success: boolean) => void
    const loadSavedQuote = vi.fn(async () => savedQuote())
    const preparation = prepareSavedQuoteExport({
      saveDraft: () => new Promise<boolean>((resolve) => { finishSave = resolve }),
      captureIsCurrent: () => () => true,
      loadSavedQuote,
      groupMode: "room",
    })
    expect(loadSavedQuote).not.toHaveBeenCalled()
    finishSave(true)
    const { snapshot } = await preparation
    expect(loadSavedQuote).toHaveBeenCalledOnce()
    expect(snapshot).toMatchObject({ quoteNo: "QT-SAVED-1", status: "草稿", subtotal: 200, discountTotal: 10, total: 240, installationFee: 50 })
    expect(snapshot.items[0]).toMatchObject({ id: "saved-product", image: "/saved-product.png", pointIds: ["point-1", "point-2"] })
    expect(snapshot.groups).toEqual([{ name: "一楼 / 客厅", items: snapshot.items }])
  })

  it("stops after a failed or superseded save without reading or exporting another draft", async () => {
    const loadSavedQuote = vi.fn(async () => savedQuote())
    await expect(prepareSavedQuoteExport({ saveDraft: async () => false, captureIsCurrent: () => () => true, loadSavedQuote, groupMode: "none" })).rejects.toThrow("未完成保存")
    expect(loadSavedQuote).not.toHaveBeenCalled()
  })

  it("rejects edits or a project switch during the saved quote read", async () => {
    let current = true
    await expect(prepareSavedQuoteExport({
      saveDraft: async () => true,
      captureIsCurrent: () => () => current,
      loadSavedQuote: async () => { current = false; return savedQuote() },
      groupMode: "none",
    })).rejects.toThrow("又有修改或已切换项目")
  })

  it("retains an immutable saved snapshot and lets rendering detect later edits before printing", async () => {
    let current = true
    const payload = savedQuote()
    const result = await prepareSavedQuoteExport({ saveDraft: async () => true, captureIsCurrent: () => () => current, loadSavedQuote: async () => payload, groupMode: "none" })
    payload.data!.items![0].image = "/later-product.png"
    payload.data!.items![0].pointIds!.push("later-point")
    expect(result.snapshot.items[0].image).toBe("/saved-product.png")
    expect(result.snapshot.items[0].pointIds).toEqual(["point-1", "point-2"])
    expect(result.assertCurrent).not.toThrow()
    current = false
    expect(result.assertCurrent).toThrow("又有修改或已切换项目")
  })

  it.each([
    { data: null },
    { data: { ...savedQuote().data!, quoteNo: "" } },
    { data: { ...savedQuote().data!, total: undefined } },
    { data: { ...savedQuote().data!, subtotal: Number.NaN } },
  ])("rejects missing or incomplete server data instead of using memory values", async (payload) => {
    await expect(prepareSavedQuoteExport({ saveDraft: async () => true, captureIsCurrent: () => () => true, loadSavedQuote: async () => payload, groupMode: "none" })).rejects.toThrow("已保存报价资料不完整")
  })
})
