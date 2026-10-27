import { describe, expect, it } from "vitest"

import { buildCatalogCsv } from "../lib/catalog-sync"
import { parseImportTable } from "../lib/product-import"
import {
  PRODUCT_PLATFORMS,
  PRODUCT_PLATFORM_LABELS,
  formatProductPlatforms,
  joinProductPlatforms,
  normalizeProductPlatforms,
  primaryPlatformLabel,
} from "../lib/product-platforms"

/**
 * 生态平台由单值改多值（2026-10-23 决定）。
 * 关键约束：一个设备可同时支持多个生态；历史数据是中文单值（米家/Apple Home/其他…），
 * 迁移与导入都要能归一，而且「其他」改成「未标注」这个语义。
 */
describe("生态平台归一", () => {
  it("中文历史写法能归一成记号（迁移和导入都靠它）", () => {
    expect(normalizeProductPlatforms("米家").values).toEqual(["mijia"])
    expect(normalizeProductPlatforms("Apple Home").values).toEqual(["homekit"])
    expect(normalizeProductPlatforms("小米").values).toEqual(["mijia"])
    expect(normalizeProductPlatforms("其他").values).toEqual(["unlabeled"])
    expect(normalizeProductPlatforms("华为").values).toEqual(["huawei"])
  })

  it("多值用分号/逗号/顿号都能写，重复会去掉", () => {
    const result = normalizeProductPlatforms("米家;Apple Home；米家")
    expect(result.values.sort()).toEqual(["homekit", "mijia"])
    expect(result.unknown).toEqual([])
  })

  it("不认识的写法单独返回，交给调用方报错", () => {
    const result = normalizeProductPlatforms("米家;某某生态")
    expect(result.values).toEqual(["mijia"])
    expect(result.unknown).toEqual(["某某生态"])
  })

  it("每个平台都有中文显示，拼起来给客户看", () => {
    for (const value of PRODUCT_PLATFORMS) expect(PRODUCT_PLATFORM_LABELS[value]).toBeTruthy()
    expect(formatProductPlatforms(["mijia", "homekit"])).toBe("米家 / Apple Home")
    expect(formatProductPlatforms([], "未设置")).toBe("未设置")
    expect(primaryPlatformLabel(["homekit", "mijia"])).toBe("Apple Home")
    expect(joinProductPlatforms(["mijia", "homekit"])).toBe("米家;Apple Home")
  })
})

describe("导入与导出走多值", () => {
  const header = "系统货号,产品名称,生态平台,参数"

  it("导入：一格写多个平台，存成分号连接的记号", () => {
    const parsed = parseImportTable(`${header}\nSW-1,双键开关,"米家;Apple Home",`)
    expect(parsed.fileError).toBeNull()
    expect(parsed.records[0].errors).toEqual([])
    // 存中文标签：预演里显示的是「米家;Apple Home」，写入时再归一成记号进 platforms
    expect(parsed.records[0].values.platform).toBe("米家;Apple Home")
  })

  it("导入：不认识的平台会被拦下并说明可用值", () => {
    const parsed = parseImportTable(`${header}\nSW-1,双键开关,某某生态,`)
    const errors = parsed.records[0].errors.join("；")
    expect(errors).toContain("生态平台")
    expect(errors).toContain("不认识")
  })

  it("导出：多值拼成中文分号（发出去的表人能看懂）", () => {
    const product = {
      brand: "Aqara", capabilities: [], catalogKind: "sku", category: "开关", channels: [],
      cost: 0, description: "", deviceTypeId: "wall-switch", id: "p1", image: "",
      manufacturerModel: "", name: "双键开关", platform: "米家", platforms: ["mijia", "homekit"],
      price: 199, pricingEvidence: "", pricingStatus: "pending", protocols: [], selectionEvidence: "",
      selectionStatus: "pending", sku: "SW-1", specs: {}, stock: 0, tags: [], unit: "个",
    }
    const rows = buildCatalogCsv([product as never]).trim().split("\r\n")
    const cells = rows[1].split(",")
    const index = rows[0].split(",").indexOf("生态平台")
    expect(cells[index]).toBe("米家;Apple Home")
  })
})
