import { describe, expect, it } from "vitest"

import {
  beginPointDrag,
  containPointMapImageRect,
  dragPointPosition,
  pointMapImagePositionFromPointer,
  pointDragThresholdReached,
  pointMapPositionFromPointer
} from "../lib/point-map-interaction"

describe("point map interaction module", () => {
  it("distinguishes a click or pointer jitter from a drag in screen pixels", () => {
    const start = { clientX: 123.45, clientY: 678.9 }
    expect(pointDragThresholdReached(start, start)).toBe(false)
    expect(pointDragThresholdReached(start, { clientX: 125.45, clientY: 680.9 })).toBe(false)
    expect(pointDragThresholdReached(start, { clientX: 127.45, clientY: 678.9 })).toBe(true)
    expect(pointDragThresholdReached(start, { clientX: 120.45, clientY: 675.9 })).toBe(true)
  })

  it("converts pointer coordinates into clamped percentage positions", () => {
    expect(
      pointMapPositionFromPointer(
        { clientX: 250, clientY: 150 },
        { height: 200, left: 50, top: 50, width: 400 }
      )
    ).toEqual({ x: 50, y: 50 })

    expect(
      pointMapPositionFromPointer(
        { clientX: -100, clientY: 999 },
        { height: 200, left: 50, top: 50, width: 400 }
      )
    ).toEqual({ x: 0, y: 100 })
  })

  it("keeps the grabbed offset while previewing drag movement", () => {
    const drag = beginPointDrag({
      pointId: "point-1",
      pointPosition: { x: 40, y: 40 },
      pointerPosition: { x: 35, y: 36 }
    })

    expect(dragPointPosition(drag, { x: 50, y: 60 })).toEqual({ x: 55, y: 64 })
  })

  it.each([
    [
      { width: 1000, height: 500 },
      { left: 0, top: 200, width: 800, height: 400 }
    ],
    [
      { width: 500, height: 1000 },
      { left: 200, top: 0, width: 400, height: 800 }
    ]
  ])("uses actual contained image bounds at different aspect ratios", (image, expected) => {
    const rect = containPointMapImageRect({ left: 0, top: 0, width: 800, height: 800 }, image)
    expect(rect).toEqual(expected)
    const position = pointMapImagePositionFromPointer(
      { clientX: expected.left + expected.width * 0.25, clientY: expected.top + expected.height * 0.6 },
      rect
    )
    expect(position).toEqual({ x: 25, y: 60 })
    expect(pointMapImagePositionFromPointer({ clientX: 0, clientY: 0 }, rect)).toBeNull()
  })

  it("keeps percent coordinates after zoom and pan and ignores non-image clicks", () => {
    const transformedImageRect = { left: -100, top: 75, width: 1600, height: 800 }
    expect(pointMapImagePositionFromPointer({ clientX: 300, clientY: 555 }, transformedImageRect)).toEqual({
      x: 25,
      y: 60
    })
    expect(pointMapImagePositionFromPointer({ clientX: 1600, clientY: 555 }, transformedImageRect)).toBeNull()
    expect(pointMapImagePositionFromPointer({ clientX: NaN, clientY: 555 }, transformedImageRect)).toBeNull()
    expect(
      containPointMapImageRect({ left: 0, top: 0, width: 800, height: 800 }, { width: 0, height: 0 })
    ).toBeNull()
    expect(pointMapImagePositionFromPointer({ clientX: 1, clientY: 1 }, null)).toBeNull()
  })
})
