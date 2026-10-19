export type PropertyType = "flat" | "villa"

export type DefaultSpace = { id: string; name: string; rooms: string[] }

export const FLAT_DEFAULT_ROOMS = ["玄关", "客厅", "餐厅", "主卧", "次卧", "书房", "厨房", "卫生间", "阳台", "弱电箱"] as const

export const VILLA_DEFAULT_SPACES: readonly DefaultSpace[] = [
  { id: "villa-basement", name: "地下一层", rooms: ["车库", "影音室", "设备间", "储藏室", "卫生间"] },
  { id: "villa-1", name: "一层", rooms: ["玄关", "客厅", "餐厅", "厨房", "卫生间", "老人房", "阳台"] },
  { id: "villa-2", name: "二层", rooms: ["主卧", "次卧", "书房", "起居室", "卫生间", "阳台"] },
  { id: "villa-3", name: "三层", rooms: ["卧室", "书房", "休闲厅", "卫生间", "阳台"] },
  { id: "villa-roof", name: "露台", rooms: ["露台", "阳光房", "设备区"] },
] as const

export function normalizePropertyType(value: unknown): PropertyType | null {
  return value === "flat" || value === "villa" ? value : null
}

export function defaultSpacesForPropertyType(value: unknown): DefaultSpace[] {
  if (value === "villa") return VILLA_DEFAULT_SPACES.map((space) => ({ ...space, rooms: [...space.rooms] }))
  return [{ id: "flat-default", name: "全屋", rooms: [...FLAT_DEFAULT_ROOMS] }]
}

export function roomsForPropertyType(value: unknown, floorId?: string): string[] {
  const spaces = defaultSpacesForPropertyType(value)
  return [...(spaces.find((space) => space.id === floorId)?.rooms ?? spaces[0].rooms)]
}
