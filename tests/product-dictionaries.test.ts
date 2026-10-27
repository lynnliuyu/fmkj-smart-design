import { describe, expect, it, vi } from "vitest"

import type { AdminProduct } from "../lib/product-admin-service"
import { applyProductImport } from "../lib/product-import-service"
import { checkDictionaryMembership, type ProductDictionaries } from "../lib/product-dictionaries"

/**
 * 品牌/系列/型号受控字典（2026-10-23 决定）。
 * 规则：手动导入时品牌、型号必须来自字典；官方资料同步不以本地字典为准（上游是权威）。
 */
const dictionaries: ProductDictionaries = {
  brands: [
    { id: "b1", isActive: true, name: "Aqara", note: null },
    { id: "b2", isActive: true, name: "易来/yeelight", note: null },
  ],
  models: [
    { id: "m1", isActive: true, name: "QBKG28LM", note: null, brandName: "Aqara", seriesName: "D1" },
  ],
  series: [
    { id: "s1", isActive: true, name: "D1", note: null, brandName: "Aqara" },
  ],
}

describe("字典成员校验", () => {
  it("字典里的品牌和型号能过，大小写与空格不误判", () => {
    expect(checkDictionaryMembership(dictionaries, { brand: "Aqara", model: "qBKG28lm" })).toEqual([])
    expect(checkDictionaryMembership(dictionaries, { brand: " aqara " })).toEqual([])
  })

  it("不在字典里的品牌/型号会被指出（型号还要对得上品牌）", () => {
    expect(checkDictionaryMembership(dictionaries, { brand: "小米" })).toEqual(["品牌「小米」不在字典里"])
    expect(checkDictionaryMembership(dictionaries, { brand: "易来/yeelight", model: "QBKG28LM" })).toEqual([
      "型号「QBKG28LM」不在字典里（品牌：易来/yeelight）",
    ])
  })

  it("空值不算错误（老产品本来就可能还没填）", () => {
    expect(checkDictionaryMembership(dictionaries, { brand: "", model: "" })).toEqual([])
    expect(checkDictionaryMembership(dictionaries, { brand: "Aqara", model: null })).toEqual([])
  })
})

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    brand: "Aqara", capabilities: [], catalogKind: "sku", category: "开关", channels: [], cost: 0,
    createdAt: "2026-10-01T00:00:00Z", description: null, deviceTypeId: "wall-switch", id: "p1", image: null,
    manufacturerModel: null, name: "双键开关", platform: "米家", platforms: ["mijia"], price: 199,
    pricingEvidence: "", pricingStatus: "pending", protocols: [], reviewNote: null, reviewedAt: null,
    reviewedBy: null, selectionEvidence: "", selectionStatus: "pending", series: null, sku: "SW-1",
    specs: {}, status: "approved", stock: 0, submittedBy: null, tags: [], unit: "个", updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  } as AdminProduct
}

const csv = [
  "系统货号,产品名称,品牌,厂家型号",
  "SW-1,双键开关,Aqara,QBKG28LM",
  "SW-2,三键开关,小米,QBKG99XX",
].join("\n")

describe("手动导入按字典严格校验", () => {
  it("字典外的品牌/型号整行失败，并说清原因；合法的照常新增", async () => {
    const create = vi.fn(async () => product())
    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [], update: vi.fn() }, {
      dictionaries,
      existing: "update",
    })

    expect(result.created).toBe(1)
    expect(result.failed).toBe(1)
    const failed = result.rows.find((row) => row.status === "failed")
    expect(failed?.message).toContain("品牌「小米」不在字典里")
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("不注入字典时不校验（官方资料同步以运营方为准）", async () => {
    const create = vi.fn(async () => product())
    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [], update: vi.fn() }, { existing: "update" })

    expect(result.created).toBe(2)
    expect(result.failed).toBe(0)
  })
})
