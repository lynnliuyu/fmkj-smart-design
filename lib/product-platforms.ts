/**
 * 生态平台（产品支持哪个智能家居生态）。
 *
 * 一个设备常常同时支持米家 + Apple Home，所以是**多值**。库里存英文记号，
 * 界面显示中文；导入/导出用分号分隔（与通信协议一致）。
 *
 * 历史数据里是中文单值（米家 / Apple Home / 华为 / tuya / knx / 其他），
 * 迁移与导入都通过 normalizeProductPlatforms 归一，不会因为写法不同而丢数据。
 */
export const PRODUCT_PLATFORMS = [
  "mijia",        // 米家
  "homekit",      // Apple Home
  "huawei",       // 华为
  "tuya",         // Tuya
  "knx",          // KNX
  "alexa",        // Amazon Alexa
  "google-home",  // Google Home
  "unlabeled",    // 未标注（旧数据里的「其他」）
] as const

export type ProductPlatform = (typeof PRODUCT_PLATFORMS)[number]

export const PRODUCT_PLATFORM_LABELS: Record<ProductPlatform, string> = {
  mijia: "米家",
  homekit: "Apple Home",
  huawei: "华为",
  tuya: "Tuya",
  knx: "KNX",
  alexa: "Amazon Alexa",
  "google-home": "Google Home",
  unlabeled: "未标注",
}

/** 旧数据/手填的中文与常见写法 → 规范记号。 */
const PLATFORM_ALIASES: Record<string, ProductPlatform> = {
  "米家": "mijia",
  "小米": "mijia",
  "xiaomi": "mijia",
  "mi": "mijia",
  "apple home": "homekit",
  "applehome": "homekit",
  "homekit": "homekit",
  "苹果": "homekit",
  "华为": "huawei",
  "huawei": "huawei",
  "tuya": "tuya",
  "涂鸦": "tuya",
  "knx": "knx",
  "alexa": "alexa",
  "google home": "google-home",
  "googlehome": "google-home",
  "其他": "unlabeled",
  "未标注": "unlabeled",
  "unlabeled": "unlabeled",
}

export function isProductPlatform(value: string): value is ProductPlatform {
  return (PRODUCT_PLATFORMS as readonly string[]).includes(value)
}

/**
 * 把一行表格里的平台写法归一成记号数组。
 * 接受分号/逗号/顿号分隔，也接受中文别名；不认识的写法原样返回在 unknown 里，让调用方决定是报错还是忽略。
 */
export function normalizeProductPlatforms(input: string | readonly string[] | null | undefined): {
  values: ProductPlatform[]
  unknown: string[]
} {
  const raw = Array.isArray(input) ? [...input] : String(input ?? "").split(/[;；,，、]/)
  const values = new Set<ProductPlatform>()
  const unknown: string[] = []
  for (const item of raw) {
    const text = String(item ?? "").trim()
    if (!text) continue
    const key = text.toLowerCase()
    const mapped = (isProductPlatform(text) ? text : undefined) ?? PLATFORM_ALIASES[key] ?? PLATFORM_ALIASES[text]
    if (mapped) values.add(mapped)
    else unknown.push(text)
  }
  return { values: [...values], unknown }
}

/** 显示用：多值拼成中文，例如「米家 / Apple Home」。 */
export function formatProductPlatforms(platforms: readonly string[] | null | undefined, fallback = ""): string {
  const list = (platforms ?? []).filter(Boolean)
  if (!list.length) return fallback
  return list.map((value) => PRODUCT_PLATFORM_LABELS[value as ProductPlatform] ?? value).join(" / ")
}

/** 导出/写库用：把多值拼成一个字符串（默认分号，与通信协议一致）。 */
export function joinProductPlatforms(
  platforms: readonly string[] | null | undefined,
  separator = ";",
  options: { labels?: boolean } = {},
): string {
  const list = (platforms ?? []).filter(Boolean)
  if (!list.length) return ""
  return list
    .map((value) => (options.labels === false ? value : PRODUCT_PLATFORM_LABELS[value as ProductPlatform] ?? value))
    .join(separator)
}

/** 写库时的「首选平台」：多值里的第一个，存成中文名，老逻辑（报价匹配/展示）继续按单值工作。 */
export function primaryPlatformLabel(platforms: readonly string[] | null | undefined): string | null {
  const first = (platforms ?? []).filter(Boolean)[0]
  if (!first) return null
  return PRODUCT_PLATFORM_LABELS[first as ProductPlatform] ?? first
}
