import { describe, expect, it } from "vitest"

import { diffRecord, parseImportTable } from "../lib/product-import"
import { mapProduct } from "../lib/product-admin-service"

/**
 * 「这一行有没有变化」的清单必须包含系列。
 *
 * 真 bug：diffRecord 比较了名称/品牌/型号/图片/参数…但漏了 series。官方在主站改了系列，
 * 同步到设备时被判「和库里一样」跳过，于是官方更新永远下发不下去（价格倒是保住了，属于规则 B 的一半）。
 */
function product(overrides: Record<string, unknown> = {}) {
  return mapProduct({
    id: "p1", name: "吸顶 AP", sku: "AP-1", brand: "锐捷", category: "全屋wifi",
    platform: "米家", platform_ws: null, unit: "个", price: 199, cost: 100, stock: 3,
    image: null, description: null, tags: [], channels: [], status: "approved",
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    catalog_kind: "sku", device_type_id: "wireless-ap", parent_product_id: null,
    manufacturer_model: null, series: null, specs: {}, protocols: [], capabilities: [],
    selection_status: "pending", selection_evidence: "", pricing_status: "pending",
    pricing_evidence: "", mapping_revision: 0, submitted_by: null, reviewed_by: null,
    reviewed_at: null, review_note: null, selection_reviewed_by: null, selection_reviewed_at: null,
    platforms: [],
    ...overrides,
  } as never)
}

describe("变化对比包含系列", () => {
  it("系列不同会被识别为变化", () => {
    const parsed = parseImportTable("系统货号,产品名称,系列\nAP-1,吸顶 AP,TEST-B")
    const changes = diffRecord(parsed.records[0], product())
    expect(changes.map((change) => change.label)).toContain("系列")
  })

  it("系列相同不算变化", () => {
    const parsed = parseImportTable("系统货号,产品名称,系列\nAP-1,吸顶 AP,T1")
    const changes = diffRecord(parsed.records[0], product({ series: "T1" }))
    expect(changes.map((change) => change.label)).not.toContain("系列")
  })
})
