/**
 * 品牌 / 系列 / 型号字典的**类型与纯函数**（客户端安全，不含任何数据库引用）。
 *
 * 为什么单独一个文件：产品表单和字典弹窗是客户端组件，一旦从 lib/product-dictionaries.ts
 * 导入，就会把 pg 打进浏览器包（Next 直接报 module-not-found）。服务端函数仍在那份文件里。
 */
export type DictionaryKind = "brand" | "series" | "model"

export type ProductBrandEntry = {
  id: string
  isActive: boolean
  name: string
  note: string | null
}

export type ProductSeriesEntry = ProductBrandEntry & { brandName: string }
export type ProductModelEntry = ProductSeriesEntry & { seriesName: string | null }

export type ProductDictionaries = {
  brands: ProductBrandEntry[]
  models: ProductModelEntry[]
  series: ProductSeriesEntry[]
}

/**
 * 下拉选项：只列启用的；但如果产品当前值不在启用列表里（老数据、刚停用），
 * 依然把它带出来，否则编辑老产品时会「看不见当前值」而被悄悄改掉。
 */
export function dictionaryOptions(
  entries: Array<{ isActive: boolean; name: string }>,
  current?: string | null,
): string[] {
  const names = entries.filter((entry) => entry.isActive).map((entry) => entry.name)
  const value = String(current ?? "").trim()
  if (value && !names.some((name) => name.toLowerCase() === value.toLowerCase())) names.push(value)
  return names
}

export function brandNames(dictionaries: ProductDictionaries, current?: string | null): string[] {
  return dictionaryOptions(dictionaries.brands, current)
}

export function seriesNames(dictionaries: ProductDictionaries, brand: string, current?: string | null): string[] {
  const value = String(brand ?? "").trim().toLowerCase()
  const filtered = dictionaries.series.filter((entry) => !value || entry.brandName.trim().toLowerCase() === value)
  return dictionaryOptions(filtered, current)
}

export function modelNames(
  dictionaries: ProductDictionaries,
  brand: string,
  series?: string | null,
  current?: string | null,
): string[] {
  const brandValue = String(brand ?? "").trim().toLowerCase()
  const seriesValue = String(series ?? "").trim().toLowerCase()
  const filtered = dictionaries.models.filter((entry) => {
    if (brandValue && entry.brandName.trim().toLowerCase() !== brandValue) return false
    // 型号没挂系列时（老数据常见），任何系列下都列出来，别把人卡住。
    if (seriesValue && entry.seriesName && entry.seriesName.trim().toLowerCase() !== seriesValue) return false
    return true
  })
  return dictionaryOptions(filtered, current)
}
