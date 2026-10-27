import { describe, expect, it } from "vitest"

import { fromCents, lineAmount, roundMoney, sumMoney, toCents } from "../lib/money"
import { lineTotal, money, quoteUnitPrice } from "../lib/quote-authoring"

const cents = (value: number) => Math.round(value * 100)

describe("金额的基本单位", () => {
  it("元与分互转不丢精度", () => {
    expect(toCents(0.1)).toBe(10)
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(139)).toBe(13900)
    expect(fromCents(1999)).toBe(19.99)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })

  it("脏输入不会算出 NaN 或负数尾巴", () => {
    expect(toCents(Number.NaN)).toBe(0)
    expect(roundMoney(0)).toBe(0)
    expect(lineAmount(10, Number.NaN)).toBe(0)
  })
})

describe("浮点误差本来会怎么出错（这些就是修掉的东西）", () => {
  it("0.1 + 0.2 这类求和不再出现 0.30000000000000004", () => {
    expect(0.1 + 0.2).not.toBe(0.3)          // 原样提醒：裸浮点确实会错
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
  })

  it("三件 19.99 元加起来正好是 59.97，且转成分不掉一分", () => {
    expect(sumMoney([19.99, 19.99, 19.99])).toBe(59.97)
    expect(cents(sumMoney([19.99, 19.99, 19.99]))).toBe(5997)
  })

  it("半分钱边界（1.005 / 0.145 / 10.075）按十进制四舍五入，不再少一分", () => {
    // 裸浮点乘 100 的经典坑：1.005 * 100 = 100.49999999999999，Math.round 会得到 100。
    expect(1.005 * 100).not.toBe(100.5)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(0.145)).toBe(0.15)
    expect(roundMoney(10.075)).toBe(10.08)
    expect(roundMoney(1.0049999)).toBe(1)
  })

  it("折后价按分取整，折扣额与「原价 − 折后价」永远对得上", () => {
    const price = 139
    const payable = lineAmount(price, 3, 95)      // 139 × 3 × 95%
    const subtotal = lineAmount(price, 3)
    expect(payable).toBe(396.15)
    expect(subtotal).toBe(417)
    expect(roundMoney(subtotal - payable)).toBe(20.85)
    expect(cents(payable) + cents(subtotal - payable)).toBe(cents(subtotal))
  })

  it("除不尽的折扣也不留长尾（98.04878… 这种真实数据）", () => {
    const amount = lineAmount(10.25, 1, 98.04878048780488)
    expect(amount).toBe(10.05)
    expect(String(amount)).not.toMatch(/\d{4,}$/)
  })

  it("数量为非整数时同样收敛到分", () => {
    expect(lineAmount(3.33, 3)).toBe(9.99)
    expect(lineAmount(0.07, 3)).toBe(0.21)
  })
})

describe("接到报价单上", () => {
  it("行金额与单价都走同一套取整，展示值等于存下来的值", () => {
    const item = { price: 139, quantity: 3, discount: 95 } as never
    expect(lineTotal(item)).toBe(396.15)
    expect(money(lineTotal(item))).toBe("¥396.15")
    expect(quoteUnitPrice(item)).toBe("¥132.05")   // 139 × 95% = 132.05
  })

  it("不打折时行金额就是单价 × 数量", () => {
    expect(lineTotal({ price: 19.99, quantity: 3, discount: 100 } as never)).toBe(59.97)
  })

  it("价格为 0 时仍显示「待核价」，不显示 ¥0", () => {
    expect(quoteUnitPrice({ price: 0, quantity: 1, discount: 100 } as never)).toBe("待核价")
  })
})
