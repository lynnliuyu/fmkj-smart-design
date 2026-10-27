import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { FIRST_PROPOSAL_THEMES, FirstProposalDocument, type FirstProposalTheme } from "../components/projects/first-proposal-document"
import type { DocumentBrand } from "../lib/document-brand"
import { emptyPointMapPlan } from "../lib/point-map-plan"
import type { ProjectDeliveryQuoteItem, ProjectDeliverySnapshot } from "../lib/project-delivery"
import { money } from "../lib/quote-authoring"

const brand: DocumentBrand = {
  companyName: "合成测试设计店", logoSrc: "/test-logo.png", contact: "测试联系方式",
  address: "测试门店地址", qrSrc: "/test-qr.png",
}
const reasons = ["参数资料仍待核对", "现场接线条件需要复核", "价格尚未核验", "配套未计入本次报价：轨道长度与电源配件"]

function item(index = 1, overrides: Partial<ProjectDeliveryQuoteItem> = {}): ProjectDeliveryQuoteItem {
  return {
    id: `test-product-${index}`, lineId: `test-line-${index}`, name: `测试智能设备${index}`,
    brand: "测试产品品牌", sku: `TEST-SKU-${index}`, spec: "双键 · 现场条件待复核",
    category: "测试设备类别", unit: "台", quantity: 3, image: `/test-product-${index}.png`, room: "一层 / 客厅",
    price: 99, cost: 982634.17, discount: 80, finalUnitPrice: 7.77, subtotalAmount: 297, finalAmount: 23.31,
    productSnapshot: {
      quotationVerification: { status: "unverified", source: "default", reasons },
      internalCostNotes: "INTERNAL_COST_SECRET",
    },
    ...overrides,
  }
}

function snapshot(): ProjectDeliverySnapshot {
  return {
    id: "test-delivery", version: 6, createdAt: "2026-10-22T20:00:00Z", pointMapRevision: 8,
    project: { id: "test-project", name: "合成测试住宅", code: "TEST-PROJECT", customer: "测试客户", address: "测试项目地址" },
    plan: {
      ...emptyPointMapPlan("test-project"),
      floors: [{ id: "floor-one", name: "一层", floorplanName: "test.png", floorplanDataUrl: "data:image/png;base64,test", imageWidth: 3000, imageHeight: 2000 }],
      points: [
        { id: "point-one", code: "K01", name: "客厅测试点位", room: "一层 / 客厅", floorId: "floor-one", iconId: "switch-2", status: "planned", x: 40, y: 50, productId: "test-product-1", note: "", placed: true },
        { id: "point-two", code: "K02", name: "待定位测试点位", room: "一层 / 卧室", floorId: "floor-one", iconId: "switch-2", status: "pending", x: 0, y: 0, productId: "", note: "位置待核对", placed: false },
      ],
      scenes: [
        { id: "scene-proposed", name: "测试待定场景", trigger: "测试触发条件甲", description: "测试动作说明甲", pointIds: ["point-one"], status: "proposed" },
        { id: "scene-confirmed", name: "测试确认场景", trigger: "测试触发条件乙", description: "测试动作说明乙", pointIds: ["point-two"], status: "confirmed" },
      ],
    },
    quote: {
      id: "test-quote", quoteNo: "QT-SYNTHETIC-TEST", title: "测试已保存报价", status: "draft",
      subtotal: 777.72, discount: 600.15, installationFee: 2.39, total: 128.03,
      rooms: ["一层 / 客厅", "一层 / 卧室"], items: [item()],
    },
    products: [{ id: "test-product-1", name: "测试智能设备1", image: "data:image/png;base64,archived-test-photo", imageSource: "/old-test-photo.png", visualAsset: null }],
    changes: { comparedToVersion: 5, floorIds: [], pointsAdded: 0, pointsRemoved: 0, pointsChanged: 0, productsChanged: [], photosChanged: [], scenesChanged: false, quoteChanged: false, productOverrides: 0, messages: [] },
    fingerprint: "test-fixed-fingerprint",
  }
}

function render(theme: FirstProposalTheme, data = snapshot(), demo = false) {
  return renderToStaticMarkup(<FirstProposalDocument snapshot={data} floors={[{ id: "floor-one", name: "一层", src: "blob:fixed-floor-one" }]} brand={brand} theme={theme} demo={demo} />)
}

describe.each<FirstProposalTheme>(["warm", "atelier", "nature", "gallery"])("%s first proposal document", (theme) => {
  it("retains every line's verification reasons and omitted material scope in the product and price detail", () => {
    const html = render(theme)
    for (const reason of reasons) expect(html.split(reason).length - 1).toBeGreaterThanOrEqual(2)
    expect(html).toContain("未核验 · 默认型号")
    expect(html).toContain("配套未计入本次报价：轨道长度与电源配件")
    expect(html).toContain('src="data:image/png;base64,archived-test-photo"')
    expect(html).toContain('src="blob:fixed-floor-one"')
    expect(html).toContain("固定交付版本 V6")
    expect(html).toContain("QT-SYNTHETIC-TEST")
  })

  it("keeps proposed scenes pending and distinguishes design confirmation from completed installation", () => {
    const html = render(theme)
    const sceneCards = html.split('<article class="fp-scene">').slice(1).map((card) => card.slice(0, card.indexOf("</article>")))
    const pending = sceneCards.find((card) => card.includes("测试待定场景"))!
    const confirmed = sceneCards.find((card) => card.includes("测试确认场景"))!
    expect(pending).toContain(">待确认<")
    expect(pending).not.toContain(">设计已确认<")
    expect(confirmed).toContain(">设计已确认<")
    expect(html).toContain("不代表设备已经安装或功能已经验收")
    expect(html).toContain("测试触发条件甲")
    expect(html).toContain("测试动作说明甲")
    expect(html).toContain("K01")
  })

  it("prefers the stored decimal unit, line and payable totals without recalculating them", () => {
    const data = snapshot()
    const html = render(theme, data)
    expect(html).toContain(money(7.77))
    expect(html).toContain(money(23.31))
    expect(html).toContain(money(128.03))
    expect(html).toContain(money(777.72))
    expect(html).toContain(money(600.15))
    expect(html).not.toContain(money(99 * 0.8 * 3))
    expect(html).not.toContain(money(777.72 - 600.15 + 2.39))
  })

  it("shows missing quote and scenes honestly without adding products or prices", () => {
    const data = snapshot()
    data.quote = null
    data.products = []
    data.plan.points = []
    data.plan.scenes = []
    const html = render(theme, data)
    expect(html).toContain("本版本尚未保存场景")
    expect(html).toContain("本版尚未保存报价")
    expect(html).toContain("暂不将生活设想写成已包含功能")
    expect(html).not.toContain("测试智能设备1")
    expect(html).not.toContain("QT-SYNTHETIC-TEST")
    expect(html).not.toMatch(/[¥￥]/)
  })

  it("keeps long text and every item across multiple quotation and scene pages", () => {
    const data = snapshot()
    const longText = "完整保留需要现场核对的中文说明".repeat(35)
    data.quote!.items = Array.from({ length: 18 }, (_, index) => item(index + 1, { name: `长产品项目第${index + 1}项`, spec: index === 0 ? longText : `规格测试${index + 1}` }))
    data.plan.scenes = Array.from({ length: 12 }, (_, index) => ({ id: `long-scene-${index}`, name: `长场景项目第${index + 1}项`, trigger: `触发测试${index + 1}`, description: index === 0 ? longText : `动作测试${index + 1}`, status: "proposed", pointIds: ["point-one"] }))
    const html = render(theme, data)
    for (const quoteItem of data.quote!.items) expect(html).toContain(quoteItem.name)
    for (const scene of data.plan.scenes) expect(html).toContain(scene.name)
    expect(html).toContain(longText)
    expect(html.split('<table class="fp-quote-table">').length - 1).toBeGreaterThan(1)
    expect(html.split('class="fp-page fp-scenes-page"').length - 1).toBeGreaterThan(1)
    expect(html).not.toContain("...")
  })

  it("uses the selected visual style and customer brand without internal cost or demo labels", () => {
    const html = render(theme)
    expect(html).toContain(`data-proposal-theme="${theme}"`)
    expect(html).toContain(FIRST_PROPOSAL_THEMES[theme].heroSrc)
    expect(html).toContain(brand.companyName)
    expect(html).toContain(brand.contact)
    expect(html).toContain(brand.address)
    expect(html).toContain(brand.qrSrc)
    for (const privateText of ["INTERNAL_COST_SECRET", "982634.17", money(982634.17), ">成本<", "内部成本", "毛利"]) expect(html).not.toContain(privateText)
    for (const demoText of ["示例演示", "非客户正式报价", "演示稿", "模拟案例", "DEMO-"]) expect(html).not.toContain(demoText)
    expect(render(theme, snapshot(), true)).toContain("示例演示 · 非客户正式报价")
  })
})
