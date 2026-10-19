/** 产品规格里的按键数；只认整数。 */
export function ownKeyCount(product: { specs?: Record<string, unknown> | null }): number | undefined {
  const value = product.specs?.button_count
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}

/**
 * 为指定键数找到可计数的具体产品：本身带该键数则返回自身，
 * 否则返回主型号下带该键数的子规格。找不到返回 undefined。
 */
export function leafForKeyCount<T extends { id: string; parentProductId?: string | null; specs?: Record<string, unknown> | null }>(
  main: T,
  keyCount: number,
  all: readonly T[],
): T | undefined {
  if (ownKeyCount(main) === keyCount) return main
  return all.find((product) => product.parentProductId === main.id && ownKeyCount(product) === keyCount)
}

/** 产品能否服务于指定键数；0 表示不区分键数。 */
export function servesKeyCount<T extends { id: string; parentProductId?: string | null; specs?: Record<string, unknown> | null }>(
  product: T,
  keyCount: number,
  all: readonly T[],
): boolean {
  return keyCount === 0 || leafForKeyCount(product, keyCount, all) !== undefined
}
