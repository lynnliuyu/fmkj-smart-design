import { roomsForPropertyType, type PropertyType } from "./project-spaces"
import type { PointMapFloor, PointMapNode } from "./point-map-plan"

export const POINT_ROOM_MAX_LENGTH = 256
export const UNASSIGNED_POINT_ROOM = "未分配"

export function normalizeRoomName(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

/**
 * 点位可选房间：楼层已保存的清单优先，否则使用户型默认房间；
 * 再并入该楼层已有点位使用的房间，保证旧点位的房间始终可选。
 */
export function floorRoomOptions({
  propertyType,
  floor,
  points,
}: {
  propertyType: PropertyType | null | undefined
  floor: Pick<PointMapFloor, "id" | "rooms"> | undefined
  points: readonly PointMapNode[]
}): string[] {
  const base = floor?.rooms ?? roomsForPropertyType(propertyType, floor?.id)
  const used = points.filter((point) => point.floorId === floor?.id).map((point) => point.room)
  return unique([...base, ...used].map(normalizeRoomName).filter(Boolean))
}

/** 返回加入新房间后的完整清单；重名时不重复添加。 */
export function nextFloorRooms(options: readonly string[], name: string): string[] {
  const room = normalizeRoomName(name)
  if (!room) throw new Error("房间名称不能为空。")
  if (room.length > POINT_ROOM_MAX_LENGTH) throw new Error(`房间名称不能超过 ${POINT_ROOM_MAX_LENGTH} 个字符。`)
  return unique([...options, room])
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}
