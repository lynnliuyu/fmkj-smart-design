import * as React from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { QuotePrintDocument, type QuotePrintSnapshot } from "../components/quotes/quote-print-document"
import type { DocumentBrand } from "../lib/document-brand"
import { money, type QuoteLineItem } from "../lib/quote-authoring"

const brand: DocumentBrand = {
  address: "上海市徐汇区环贸中心 12 层",
  companyName: "澄明智能家居",
  contact: "021-6000 1234",
  logoSrc: "/assets/brand/test-studio.png",
  qrSrc: "/assets/brand/test-studio-qr.png",
}

function line(overrides: Partial<QuoteLineItem> & Pick<QuoteLineItem, "lineId" | "name">): QuoteLineItem {
  return {
    category: "智能面板",
    cost: 0,
    discount: 100,
    id: overrides.lineId,
    image: "/placeholder.svg",
    price: 100,
    quantity: 1,
    room: "一楼 / 客厅",
    spec: "双键",
    unit: "个",
    ...overrides,
  }
}

// 未核验（默认型号、配套未计入）与已核验各一行：ADR 0006 的两种标识都要逐行出现。
const unverifiedLine = line({
  lineId: "line-unverified",
  name: "双键智能面板",
  price: 200,
  quantity: 3,
  productSnapshot: {
    quotationVerification: {
      status: "unverified",
      source: "default",
      reasons: ["价格尚未核验", "配套未计入本次报价：网关与线材"],
    },
  },
})
const verifiedLine = line({
  lineId: "line-verified",
  name: "调光驱动模块",
  category: "智能照明",
  discount: 80,
  price: 200,
  quantity: 1,
  room: "二楼 / 主卧",
  spec: "0-10V 调光；导轨安装",
  unit: "台",
  productSnapshot: {
    quotationVerification: { status: "verified", source: "selection", reasons: [] },
  },
})

const snapshot: QuotePrintSnapshot = {
  deliveryVersion: 3,
  quoteNo: "QT-2026-0771",
  date: "2026/10/22",
  discountTotal: 140,
  floorImages: [
    { id: "floor-1", name: "一楼", src: "blob:quote-floor-1" },
    { id: "floor-2", name: "二楼", src: "blob:quote-floor-2" },
  ],
  groups: [
    { name: "一楼 / 客厅", items: [unverifiedLine] },
    { name: "二楼 / 主卧", items: [verifiedLine] },
    { name: "三楼 / 空房间", items: [] },
  ],
  installationFee: 200,
  project: "云岭公馆 3 号楼 1802",
  status: "草稿",
  subtotal: 700,
  total: 760,
}

// 分组小计：未核验行 200 × 3 = 600；已核验行 200 × 80% × 1 = 160。
// react-dom/server 会在相邻文本节点之间插入 `<!-- -->` 分隔符，
// 断言的是客户在纸上读到的文字，先把它去掉。
function renderDocument(overrides: Partial<QuotePrintSnapshot> = {}) {
  return renderToString(
    <QuotePrintDocument {...snapshot} {...overrides} brand={brand} documentRef={React.createRef<HTMLElement>()} />
  ).replaceAll("<!-- -->", "")
}

describe("customer quote print document", () => {
  it("prints the brand header, document numbers and the four amounts without changing the wording", () => {
    const html = renderDocument()

    // 品牌页头：logo、公司名、联系方式与地址都来自传进来的品牌，填了才印。
    expect(html).toContain("澄明智能家居")
    expect(html).toContain("/assets/brand/test-studio.png")
    expect(html).toContain("021-6000 1234")
    expect(html).toContain("上海市徐汇区环贸中心 12 层")
    expect(html).toContain("智能家居方案报价单")
    expect(html).toContain(snapshot.project)
    expect(html).toContain(snapshot.quoteNo)
    expect(html).toContain("方案版本 V3")
    // 报价状态只在信息区出现一次（页头重复的那次已去掉）；页头只留编号与版本。
    expect(html.split("报价状态").length - 1).toBe(1)
    expect(html).toContain("<span>报价状态</span>")
    expect(html).toContain(snapshot.date)
    expect(html).toContain("15 天")

    // 金额口径与旧版打印件一致：产品合计是折后值，没有单独的「折扣」行。
    expect(html).toContain(money(snapshot.subtotal - snapshot.discountTotal))
    expect(html).not.toContain(money(snapshot.subtotal))
    expect(html).not.toContain("折扣")
    expect(html).toContain(money(snapshot.installationFee))
    expect(html).toContain(money(snapshot.total))
    expect(html).toContain(money(600))
    expect(html).toContain(money(160))
  })

  it("prints every non-empty group with its counts, subtotal and line-level verification notes", () => {
    const html = renderDocument()

    expect(html).toContain("报价明细")
    expect(html).toContain("共 2 组 · 2 行 · 4 件")
    expect(html).toContain("一楼 / 客厅")
    expect(html).toContain("1 行 · 3 件")
    expect(html).toContain("分组小计")
    expect(html).toContain(money(600))
    expect(html).toContain("双键智能面板")
    expect(html).toContain("智能面板")
    expect(html).toContain("3 个")

    expect(html).toContain("二楼 / 主卧")
    expect(html).toContain("调光驱动模块")
    expect(html).toContain("0-10V 调光")
    expect(html).toContain("二楼 / 主卧")
    expect(html).toContain("1 台")
    expect(html).toContain("资料已核验")

    // ADR 0006：未核验标识与配套未计入说明必须逐行可见。
    expect(html).toContain("未核验 · 默认型号 · 配套未计入本次报价：网关与线材")
    expect(html).toContain('data-verification="unverified"')
    expect(html).toContain('data-verification="verified"')

    // 房间清单里没有产品的分组不印空卡片。
    expect(html).not.toContain("三楼 / 空房间")
    // 卡片表头的六列语义与顺序不变（产品 / 规格 / 房间 / 数量 / 单价 / 总价）。
    const thead = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"))
    const labels = ["产品", "规格", "房间", "数量", "单价", "总价"]
    const positions = labels.map((label) => thead.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("keeps the closing blocks, the floor pages and the shared contact card", () => {
    const html = renderDocument()

    expect(html).toContain("费用构成")
    expect(html).toContain("报价说明")
    expect(html).toContain("报价含基础安装调试")
    expect(html).toContain("客户确认")
    expect(html).toContain("客户报价专用文件")
    // 签字区与旧版式一致：只有「客户确认」一栏，标签是「签字 / 日期」。
    expect(html).toContain('aria-label="客户确认"')
    expect(html).toContain(">签字<")
    expect(html).toContain(">日期<")
    expect(html).toContain('class="document-contact"')
    expect(html).toContain('class="quote-document-floors"')
    expect(html).toContain('alt="一楼 点位方案"')
    expect(html).toContain('alt="二楼 点位方案"')
    expect(html).toContain("blob:quote-floor-1")
  })

  it("adds no explanatory sentences and keeps only the customer's own signature column", () => {
    const html = renderDocument()

    // 只换外观：这次没有新增任何说明性句子，也没有供方盖章栏。
    for (const addedText of [
      "随附楼层点位方案",
      "供方确认",
      "经办人",
      "含安装调试费 · 共",
      "签字即表示已阅读并同意",
      "双方确认后按报价说明推进采购与安装调试",
      "未核验行使用默认型号，配套未计入本次报价的说明在对应行内标出",
    ]) {
      expect(html).not.toContain(addedText)
    }
    expect(html).toContain("客户确认")
    // 收尾区不再整块避断，改成子块各自避断。
    expect(html).not.toContain("quote-document-ending")
    expect(html).toContain("quote-document-contact")
  })

  it("never leaks the standalone template demo copy or sample numbers", () => {
    const html = renderDocument()

    for (const demoText of ["模拟案例", "示例项目", "DEMO-", "演示稿", "示例数据", "模拟数据"]) {
      expect(html).not.toContain(demoText)
    }
    for (const demoNumber of ["¥22,395.65", "22,395.65", "¥189,860.00", "189,860"]) {
      expect(html).not.toContain(demoNumber)
    }
  })

  it("hides the version badge for a quote without a fixed delivery version", () => {
    const html = renderDocument({ deliveryVersion: 0 })

    expect(html).not.toContain("方案版本 V0")
    expect(html).not.toContain("方案版本 V")
  })
})
