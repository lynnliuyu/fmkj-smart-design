import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { collectProposalBrands, normalizeProposalBrand, resolveProposalBrand } from "../lib/proposal-brand-assets"

describe("首次提案的产品品牌", () => {
  it("只接受明确别名，能处理英文大小写与全角字形", () => {
    expect(normalizeProposalBrand("　ＡＱＡＲＡ  绿米 ")).toBe("aqara 绿米")
    expect(resolveProposalBrand("　ＡＱＡＲＡ  绿米 ")?.id).toBe("aqara")
    expect(resolveProposalBrand("Yeelight")?.id).toBe("yeelight")
    expect(resolveProposalBrand("Aqara 智能开关")?.logoSrc).toBeNull()
    expect(resolveProposalBrand("小米生态链某品牌")?.id).toBe("custom:小米生态链某品牌")
  })

  it("只按报价保存的品牌字段取值，不从品名猜测，也不改动原数据", () => {
    const items = [
      { brand: "绿米", name: "小米智能开关" },
      { brand: "AQARA", name: "另一个商品" },
      { brand: " 小众自有品牌 ", name: "Yeelight 灯带" },
      { brand: null, name: "Apple HomePod" },
    ]
    const before = structuredClone(items)
    expect(collectProposalBrands(items).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "aqara", name: "Aqara 绿米" },
      { id: "custom:小众自有品牌", name: "小众自有品牌" },
    ])
    expect(items).toEqual(before)
  })

  it("小米、米家及生态名称分开，不拿 MI 标识冒充米家", () => {
    expect(resolveProposalBrand("小米")?.logoSrc).toBe("/assets/proposals/brands/xiaomi.png")
    expect(resolveProposalBrand("米家")?.logoSrc).toBe("/assets/proposals/brands/mijia.png")
    expect(resolveProposalBrand("Xiaomi Home")?.kind).toBe("ecosystem")
    expect(resolveProposalBrand("Matter")?.kind).toBe("protocol")
    expect(collectProposalBrands([{ brand: "Matter" }, { brand: "HomeKit" }, { brand: "米家 App" }, { brand: "Apple" }]).map(({ id }) => id)).toEqual(["apple"])
  })

  it("空品牌不展示，未知品牌与未授权图形保留文字回退", () => {
    expect(resolveProposalBrand(undefined)).toBeNull()
    expect(resolveProposalBrand(" \n ")).toBeNull()
    expect(resolveProposalBrand("Apple")).toMatchObject({ name: "Apple 苹果", logoSrc: null })
    expect(resolveProposalBrand("自有品牌")).toMatchObject({ name: "自有品牌", logoSrc: null, sourceUrl: null })
  })

  it("图形都来自有记录的官网本地资产，避开已有手绘替代标识", () => {
    for (const name of ["Aqara", "小米", "米家", "Yeelight"]) {
      const asset = resolveProposalBrand(name)!
      expect(asset.logoSrc).toMatch(/^\/assets\/proposals\/brands\//)
      expect(existsSync(join(process.cwd(), "public", asset.logoSrc!))).toBe(true)
      expect(asset.sourceUrl).toMatch(/^https:\/\//)
      expect(asset.assetSourceUrl).toMatch(/^https:\/\//)
      expect(asset.usageNote).toContain("不表示品牌授权")
    }
    const svg = readFileSync(join(process.cwd(), "public", resolveProposalBrand("Aqara")!.logoSrc!), "utf8")
    expect(svg).toContain("<svg")
    expect(svg).not.toContain("<text")
    expect(svg).not.toMatch(/<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/)
  })
})
