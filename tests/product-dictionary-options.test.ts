import { describe, expect, it } from "vitest"

import { brandNames, modelNames, seriesNames, type ProductDictionaries } from "../lib/product-dictionary-types"

/**
 * 表单里的品牌/系列/型号下拉（2026-10-23）。
 * 关键行为：只列启用的；但产品当前值若已停用或不在字典里，依然要显示，否则编辑老产品会被悄悄改掉。
 */
const dictionaries: ProductDictionaries = {
  brands: [
    { id: "b1", isActive: true, name: "Aqara", note: null },
    { id: "b2", isActive: true, name: "易来/yeelight", note: null },
    { id: "b3", isActive: false, name: "旧品牌", note: null },
  ],
  series: [
    { id: "s1", isActive: true, name: "D1", note: null, brandName: "Aqara" },
    { id: "s2", isActive: true, name: "M2", note: null, brandName: "易来/yeelight" },
  ],
  models: [
    { id: "m1", isActive: true, name: "QBKG28LM", note: null, brandName: "Aqara", seriesName: "D1" },
    { id: "m2", isActive: true, name: "QBKG29LM", note: null, brandName: "Aqara", seriesName: null },
    { id: "m3", isActive: true, name: "YL-01", note: null, brandName: "易来/yeelight", seriesName: "M2" },
  ],
}

describe("字典下拉", () => {
  it("只列启用的品牌；停用的不出现", () => {
    expect(brandNames(dictionaries)).toEqual(["Aqara", "易来/yeelight"])
  })

  it("当前值即使已停用也带出来（避免编辑老产品时被悄悄改掉）", () => {
    expect(brandNames(dictionaries, "旧品牌")).toContain("旧品牌")
    expect(brandNames(dictionaries, "字典外的写法")).toContain("字典外的写法")
  })

  it("系列按品牌过滤", () => {
    expect(seriesNames(dictionaries, "Aqara")).toEqual(["D1"])
    expect(seriesNames(dictionaries, "易来/yeelight")).toEqual(["M2"])
    expect(seriesNames(dictionaries, "")).toEqual(["D1", "M2"])
  })

  it("型号按品牌过滤；没挂系列的型号在任何系列下都列出（老数据常见）", () => {
    expect(modelNames(dictionaries, "Aqara").sort()).toEqual(["QBKG28LM", "QBKG29LM"])
    expect(modelNames(dictionaries, "Aqara", "D1").sort()).toEqual(["QBKG28LM", "QBKG29LM"])
    expect(modelNames(dictionaries, "易来/yeelight").sort()).toEqual(["YL-01"])
  })
})
