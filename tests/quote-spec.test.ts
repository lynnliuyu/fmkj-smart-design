import { describe, expect, it } from "vitest"
import { quoteDisplaySpec } from "../lib/quote-spec"

describe("quote document spec", () => {
  it("keeps the first short selling points", () => {
    expect(quoteDisplaySpec("墙面嵌入式智能中控屏；全面屏触控；小爱同学 AI 大模型；智能家庭面板。包装含中控屏", "Xiaomi 智能中控屏"))
      .toBe("墙面嵌入式智能中控屏；全面屏触控")
  })

  it("drops internal sourcing notes and the repeated product name", () => {
    const spec = "苏米智能开关 H2 Pro+（单零火版） 系列，1 键配置。两个来源说法不一致：京家标『单火』、万嘉标『单/零火』，冲突未决，不填 wiring。按键数与价格来自渠道供货规格；继电器路数待厂家资料核实。"
    expect(quoteDisplaySpec(spec, "苏米智能开关 H2 Pro+（单零火版） 1键")).toBe("1 键配置")
  })

  it("hides import batch codes", () => {
    expect(quoteDisplaySpec("XLSX-CLEAN-0514", "领普 CE1 智能电机")).toBe("")
  })

  it("truncates a single long segment", () => {
    const result = quoteDisplaySpec("10 口千兆 PoE 交换机（8口 PoE + 2 SFP 光口上行），120W 总功率", "交换机")
    expect(result.length).toBeLessThanOrEqual(26)
    expect(result.endsWith("…")).toBe(true)
  })

  it("handles empty spec", () => {
    expect(quoteDisplaySpec(undefined)).toBe("")
  })
})
