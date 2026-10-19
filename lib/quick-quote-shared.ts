export type QuickTier = "lite" | "full"

export type QuickModule =
  | "lights"
  | "switches"
  | "wifi"
  | "sensors"
  | "cameras"
  | "curtains"

export type QuickQuoteInput = {
  projectId: string
  platform: string
  tier: QuickTier
  bedrooms: number
  livingRooms: number
  modules: QuickModule[]
}

export type QuickQuoteResult = {
  id: string
  quoteNo: string
  savedItems: number
  skippedItems: number
  subtotal: number
  total: number
}

export const QUICK_PLATFORMS: Array<{ value: string; label: string }> = [
  { value: "米家", label: "米家" },
  { value: "蓝牙 Mesh", label: "蓝牙 Mesh" },
  { value: "Aqara / Apple Home", label: "Aqara / Apple Home" },
  { value: "华为全屋智能", label: "华为全屋智能" },
  { value: "Tuya", label: "Tuya" },
  { value: "通用", label: "通用（不限平台）" },
]

export const QUICK_MODULES: Array<{
  key: QuickModule
  label: string
  category: string
  room: string
  defaultOn: boolean
}> = [
  { key: "lights", label: "灯光", category: "智能灯具", room: "全屋", defaultOn: true },
  { key: "switches", label: "开关", category: "开关", room: "全屋", defaultOn: true },
  { key: "wifi", label: "全屋WiFi", category: "全屋wifi", room: "全屋", defaultOn: true },
  { key: "sensors", label: "传感器", category: "传感器", room: "全屋", defaultOn: true },
  { key: "cameras", label: "监控", category: "监控", room: "全屋", defaultOn: true },
  { key: "curtains", label: "窗帘", category: "窗帘", room: "卧室", defaultOn: true },
]

export const QUICK_TIERS: Array<{ value: QuickTier; label: string; description: string }> = [
  {
    value: "lite",
    label: "轻智能",
    description: "覆盖主要房间与基本联动，预算更友好",
  },
  {
    value: "full",
    label: "全屋智能",
    description: "全屋点位覆盖 + 联动 / 场景完整，预算充足推荐",
  },
]

export function computeModuleQuantity(
  moduleKey: QuickModule,
  tier: QuickTier,
  bedrooms: number,
  livingRooms: number,
): number {
  const isLite = tier === "lite"
  switch (moduleKey) {
    case "lights":
      return Math.max(1, isLite ? bedrooms * 2 + livingRooms * 3 : bedrooms * 4 + livingRooms * 4)
    case "switches":
      return Math.max(1, isLite ? bedrooms * 1 + livingRooms * 1 : bedrooms * 2 + livingRooms * 2)
    case "wifi":
      return Math.max(1, Math.ceil((bedrooms + livingRooms + (isLite ? 0 : 1)) / 2))
    case "sensors":
      return Math.max(1, isLite ? 1 : bedrooms + 1)
    case "cameras":
      return Math.max(1, isLite ? 2 : bedrooms + 1)
    case "curtains":
      return Math.max(1, isLite ? Math.max(1, Math.ceil(bedrooms / 2)) : bedrooms)
  }
}