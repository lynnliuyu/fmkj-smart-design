/** 售价未填写（空或 0）时，默认采用成本价作为售价。 */
export function defaultSellingPrice(price: number | null | undefined, cost: number | null | undefined): number {
  const selling = Number(price ?? 0)
  if (selling > 0) return selling
  return Number(cost ?? 0)
}
