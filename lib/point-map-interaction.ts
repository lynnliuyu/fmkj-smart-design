import type { PointMapPosition } from "./point-map-plan"

export type PointMapRect = {
  height: number
  left: number
  top: number
  width: number
}

export type PointMapPointer = {
  clientX: number
  clientY: number
}

/** Use screen pixels so a click remains a click at every canvas zoom level. */
export function pointDragThresholdReached(
  start: PointMapPointer,
  current: PointMapPointer
): boolean {
  return Math.hypot(current.clientX - start.clientX, current.clientY - start.clientY) >= 4
}

export type PointMapImageSize = { width: number; height: number }

/** Bounds of the actual image when object-fit: contain adds letterboxing. */
export function containPointMapImageRect(
  container: PointMapRect,
  image: PointMapImageSize
): PointMapRect | null {
  if (
    ![container.left, container.top, container.width, container.height, image.width, image.height].every(
      Number.isFinite
    ) ||
    container.width <= 0 ||
    container.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  )
    return null
  const ratio = Math.min(container.width / image.width, container.height / image.height)
  const width = image.width * ratio
  const height = image.height * ratio
  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height
  }
}

/** Unlike the legacy canvas helper, an outside click must not create an edge point. */
export function pointMapImagePositionFromPointer(
  pointer: PointMapPointer,
  imageRect: PointMapRect | null | undefined
): PointMapPosition | null {
  if (
    !imageRect ||
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    ![
      pointer.clientX,
      pointer.clientY,
      imageRect.left,
      imageRect.top,
      imageRect.width,
      imageRect.height
    ].every(Number.isFinite) ||
    pointer.clientX < imageRect.left ||
    pointer.clientX > imageRect.left + imageRect.width ||
    pointer.clientY < imageRect.top ||
    pointer.clientY > imageRect.top + imageRect.height
  )
    return null
  return {
    x: ((pointer.clientX - imageRect.left) / imageRect.width) * 100,
    y: ((pointer.clientY - imageRect.top) / imageRect.height) * 100
  }
}

export type PointDragState = {
  offset: PointMapPosition
  pointId: string
}

export function pointMapPositionFromPointer(
  pointer: PointMapPointer,
  rect: PointMapRect | null | undefined
): PointMapPosition {
  if (!rect?.width || !rect.height) {
    return { x: 50, y: 50 }
  }

  return clampPointMapPosition({
    x: ((pointer.clientX - rect.left) / rect.width) * 100,
    y: ((pointer.clientY - rect.top) / rect.height) * 100
  })
}

export function beginPointDrag({
  pointId,
  pointPosition,
  pointerPosition
}: {
  pointId: string
  pointPosition: PointMapPosition
  pointerPosition: PointMapPosition
}): PointDragState {
  return {
    offset: {
      x: pointPosition.x - pointerPosition.x,
      y: pointPosition.y - pointerPosition.y
    },
    pointId
  }
}

export function dragPointPosition(
  drag: PointDragState | null,
  pointerPosition: PointMapPosition
): PointMapPosition {
  return clampPointMapPosition({
    x: pointerPosition.x + (drag?.offset.x ?? 0),
    y: pointerPosition.y + (drag?.offset.y ?? 0)
  })
}

export function clampPointMapPosition(position: PointMapPosition): PointMapPosition {
  return {
    x: clampPercent(position.x),
    y: clampPercent(position.y)
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 50
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}
