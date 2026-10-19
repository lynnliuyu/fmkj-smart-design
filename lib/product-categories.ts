export const OTHER_PRODUCT_CATEGORY = "其他" as const

export const STANDARD_PRODUCT_CATEGORIES = [
  "监控",
  "门锁",
  "传感器",
  "窗帘",
  "开关",
  "插座",
  "暖通控制",
  "网关中控",
  "全屋wifi",
  "智能灯具",
  "普通灯具",
  OTHER_PRODUCT_CATEGORY,
] as const

export type StandardProductCategory = (typeof STANDARD_PRODUCT_CATEGORIES)[number]

const standardCategorySet = new Set<string>(STANDARD_PRODUCT_CATEGORIES)

const categoryRules: Array<{ category: StandardProductCategory; keywords: string[] }> = [
  { category: "监控", keywords: ["监控", "摄像", "camera", "ipc", "nvr"] },
  { category: "门锁", keywords: ["门锁", "智能锁", "指纹锁", "door lock", "lock", "门禁"] },
  {
    category: "传感器",
    keywords: ["传感", "人体", "存在", "温湿度", "温度", "湿度", "烟雾", "烟感", "水浸", "漏水", "门磁", "pir", "sensor"],
  },
  { category: "窗帘", keywords: ["窗帘", "卷帘", "电机", "curtain"] },
  { category: "插座", keywords: ["插座", "地插", "usb插", "socket", "outlet"] },
  { category: "暖通控制", keywords: ["暖通", "空调", "温控", "新风", "地暖", "vrf", "风机盘管", "多联机", "hvac"] },
  { category: "全屋wifi", keywords: ["wifi", "wi-fi", "无线", "ap", "mesh", "路由", "交换机", "网络覆盖", "poe", "网口"] },
  { category: "网关中控", keywords: ["网关", "中控", "妙控", "智能面板", "控制屏", "hub", "gateway", "panel"] },
  { category: "开关", keywords: ["开关", "场景", "调光", "回路", "switch", "dimmer"] },
  { category: "智能灯具", keywords: ["智能灯", "灯带", "筒灯", "射灯", "轨道灯", "磁吸灯", "智能照明"] },
  { category: "普通灯具", keywords: ["普通灯", "吊灯", "壁灯", "吸顶灯", "普通照明"] },
]

export function isStandardProductCategory(value: string | null | undefined): value is StandardProductCategory {
  return standardCategorySet.has(String(value ?? ""))
}

export function normalizeProductCategory(
  category?: string | null,
  ...hints: Array<string | null | undefined>
): StandardProductCategory {
  const normalized = String(category ?? "").trim()
  if (isStandardProductCategory(normalized)) return normalized

  const haystack = [normalized, ...hints]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")

  for (const rule of categoryRules) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return rule.category
    }
  }

  return OTHER_PRODUCT_CATEGORY
}
