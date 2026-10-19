import { describe, expect, it } from "vitest"

import {
  groupQuoteItems,
  lineTotal,
  toProductOption,
  type QuoteLineItem,
} from "../lib/quote-authoring"

describe("quote authoring module", () => {
  it("normalizes database products for quote editing", () => {
    expect(
      toProductOption({
        cost: "120" as never,
        description: null,
        id: "product-1",
        image: "",
        name: "智能面板",
        price: "300" as never,
        sku: "SKU-001",
        unit: "个",
      })
    ).toMatchObject({
      category: "未分类",
      cost: 120,
      id: "product-1",
      image: "/placeholder.svg",
      name: "智能面板",
      price: 300,
      spec: "SKU-001",
      unit: "个",
    })
  })

  it("groups quote items by room and calculates discounted totals", () => {
    const items: QuoteLineItem[] = [
      quoteLine({ lineId: "line-1", room: "客厅", price: 100, quantity: 2, discount: 80 }),
      quoteLine({ lineId: "line-2", room: "主卧", price: 50, quantity: 1, discount: 100 }),
    ]

    expect(lineTotal(items[0])).toBe(160)
    expect(groupQuoteItems(items, "room", ["开关"], ["客厅", "主卧"])).toEqual([
      { items: [items[0]], name: "客厅" },
      { items: [items[1]], name: "主卧" },
    ])
  })
})

function quoteLine(patch: Partial<QuoteLineItem>): QuoteLineItem {
  return {
    category: "开关",
    cost: 0,
    discount: 100,
    id: "product",
    image: "/placeholder.svg",
    lineId: "line",
    name: "产品",
    price: 0,
    quantity: 1,
    room: "客厅",
    spec: "",
    unit: "个",
    ...patch,
  }
}
