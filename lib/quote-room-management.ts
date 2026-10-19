import { pointIdsRemovedByLines } from "./point-map-quote-removal"

export type QuoteRoomItem = {
  room: string
  pointMapProjectId?: string
  pointIds?: string[]
}

export const POINT_SOURCED_ROOM_BLOCKED_MESSAGE = "该房间有点位同步来的明细，房间名由点位设计决定。请先在点位设计中修改或移走这些点位，再同步报价。"

/** 点位来源的房间改名需要回到点位设计；删除按用户明确的联动规则处理。 */
function hasPointSourcedRows(items: QuoteRoomItem[], roomName: string) {
  return items.some((item) => item.room === roomName && Boolean(item.pointMapProjectId))
}

export const DEFAULT_QUOTE_ROOM = "全屋"

export function addQuoteRoom(rooms: string[], roomName: string) {
  const nextRoom = roomName.trim()
  if (!nextRoom) return rooms

  return unique([...rooms, nextRoom])
}

export function renameQuoteRoom<TItem extends QuoteRoomItem>(
  rooms: string[],
  items: TItem[],
  oldName: string,
  newName: string,
) {
  const nextName = newName.trim()

  if (!nextName || oldName === nextName) {
    return { changed: false, blocked: false, items, rooms }
  }
  if (hasPointSourcedRows(items, oldName)) return { changed: false, blocked: true, items, rooms }

  return {
    changed: true,
    blocked: false,
    items: items.map((item) => (item.room === oldName ? { ...item, room: nextName } : item)),
    rooms: unique(rooms.map((room) => (room === oldName ? nextName : room))),
  }
}

export function deleteQuoteRoom<TItem extends QuoteRoomItem>(rooms: string[], items: TItem[], roomName: string) {
  const removedPointIds = pointIdsRemovedByLines(items.filter((item) => item.room === roomName))
  const nextRooms = rooms.filter((room) => room !== roomName)
  const fallbackRoom = nextRooms[0] ?? DEFAULT_QUOTE_ROOM

  return {
    blocked: false,
    removedPointIds,
    items: items.filter((item) => item.room !== roomName || !item.pointMapProjectId).map((item) => (item.room === roomName ? { ...item, room: fallbackRoom } : item)),
    rooms: nextRooms.length ? nextRooms : [fallbackRoom],
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}
