/**
 * 钱的算术。
 *
 * 直接用浮点相乘相加，会在报价单上露出 `99.99999999999999`、或者出现
 * 「折扣前 200 − 折后 190 = 折扣 10.000000000000014」这种对不上的数字。
 * 客户看到数字对不上就会质疑，财务要手工改单。
 *
 * 做法：把金额换成「分」的整数再算，最后一步才除回 100。
 * 这样求和天然精确（整数相加不会有误差），只有乘折扣那一步有一次四舍五入。
 *
 * 边界说明：单价超过两位小数（例如成本 0.125）会先被取整到分——这是有意的，
 * 金额的最小单位就是分。
 */

export function toCents(value: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0

  // 按十进制字符串取整，而不是 Math.round(value * 100)：
  // 1.005 * 100 在二进制里是 100.49999999999999，直接 round 会少一分钱。
  // toString() 给出的是「最短可还原」的十进制写法，正好是用户/数据库看到的那个数。
  const sign = number < 0 ? -1 : 1
  const text = Math.abs(number).toString()
  if (text.includes("e") || text.includes("E")) {
    // 极小或极大的科学计数法（钱不会长这样），退回普通取整，别在这里卡住。
    return sign * Math.round(Math.abs(number) * 100)
  }

  const [integerPart, fractionPart = ""] = text.split(".")
  const digits = (fractionPart + "000").slice(0, 3)
  const cents = Number(integerPart || "0") * 100 + Number(digits.slice(0, 2))
  // 半分钱按四舍五入进一分，和财务口径一致。
  return sign * (cents + (Number(digits[2]) >= 5 ? 1 : 0))
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** 把任意金额取整到分，用于展示与存储前的归一。 */
export function roundMoney(value: number): number {
  return fromCents(toCents(value))
}

/** 一行金额：单价 × 数量 × 折扣百分比（100 = 不打折）。 */
export function lineAmount(price: number, quantity: number, discountPercent = 100): number {
  const quantityNumber = Number.isFinite(Number(quantity)) ? Number(quantity) : 0
  const discountNumber = Number.isFinite(Number(discountPercent)) ? Number(discountPercent) : 100
  return fromCents(Math.round((toCents(price) * quantityNumber * discountNumber) / 100))
}

/** 求和：先转成分再相加，结果是精确到分的金额。 */
export function sumMoney(values: number[]): number {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0))
}
