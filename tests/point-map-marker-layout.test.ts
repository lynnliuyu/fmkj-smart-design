import { describe, expect, it } from "vitest"
import { layoutPointMapMarkers, type PointMapMarkerPlacement, type PointMapMarkerLayoutInput } from "../lib/point-map-marker-layout"

function input(markers: PointMapMarkerLayoutInput["markers"]): PointMapMarkerLayoutInput {
  return { markers, bounds: { left: 0, top: 0, width: 600, height: 500 }, radius: 22, labelHeight: 16, labelWidth: (label) => label.length * 8 }
}

function distanceToLabel(x: number, y: number, label: PointMapMarkerPlacement) {
  const nearestX = Math.max(label.labelX, Math.min(x, label.labelX + label.labelWidth))
  const nearestY = Math.max(label.labelY, Math.min(y, label.labelY + label.labelHeight))
  return Math.hypot(x - nearestX, y - nearestY)
}

function expectNoOverlaps(placements: PointMapMarkerPlacement[], radius: number) {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      expect(Math.hypot(placements[i].x - placements[j].x, placements[i].y - placements[j].y)).toBeGreaterThanOrEqual(2 * radius)
      const a = placements[i], b = placements[j]
      expect(a.labelX + a.labelWidth <= b.labelX || b.labelX + b.labelWidth <= a.labelX || a.labelY + a.labelHeight <= b.labelY || b.labelY + b.labelHeight <= a.labelY).toBe(true)
    }
    for (const other of placements) expect(distanceToLabel(other.x, other.y, placements[i])).toBeGreaterThanOrEqual(radius)
  }
}

describe("enlarged point-map marker placement", () => {
  it("honors fixed manual circle and label positions while automatic points avoid them", () => {
    const placed = layoutPointMapMarkers(input([
      { id: "automatic", x: 210, y: 100, label: "A" },
      { id: "manual", x: 100, y: 100, label: "B", display: { x: 210, y: 100, labelX: 206, labelY: 126 } },
    ]))
    expect(placed.map((point) => point.id)).toEqual(["automatic", "manual"])
    expect(placed[1]).toMatchObject({ x: 210, y: 100, anchorX: 100, anchorY: 100, labelX: 206, labelY: 126 })
    expectNoOverlaps(placed, 22)
  })

  it("reports invalid fixed placements instead of moving or omitting them", () => {
    expect(() => layoutPointMapMarkers(input([{ id: "fixed", x: 100, y: 100, label: "A", display: { x: 2, y: 2, labelX: 20, labelY: 28 } }]))).toThrow("手工展示位置")
    expect(() => layoutPointMapMarkers(input([{ id: "fixed", x: 100, y: 100, label: "A", display: { x: 100, y: 100, labelX: 100, labelY: 100 } }]))).toThrow("手工展示位置")
  })
  it("keeps isolated circles at their installation anchors and puts labels below", () => {
    const original = input([{ id: "a", x: 100, y: 100, label: "K01" }, { id: "b", x: 350, y: 300, label: "K02" }])
    const placed = layoutPointMapMarkers(original)
    expect(placed.map(({ id, x, y, anchorX, anchorY, displaced }) => ({ id, x, y, anchorX, anchorY, displaced }))).toEqual([
      { id: "a", x: 100, y: 100, anchorX: 100, anchorY: 100, displaced: false },
      { id: "b", x: 350, y: 300, anchorX: 350, anchorY: 300, displaced: false },
    ])
    expect(placed.every((point) => point.labelY > point.y + original.radius)).toBe(true)
    expectNoOverlaps(placed, original.radius)
  })

  it("separates the actual close panel, switch, infrastructure and curtain groups without losing points", () => {
    const original = input([
      { id: "P004", x: 115, y: 105, label: "P004" },
      { id: "K05", x: 125, y: 100, label: "L1-K05" },
      { id: "K06", x: 148, y: 102, label: "L1-K06" },
      { id: "K10", x: 305, y: 105, label: "L1-K10" },
      { id: "K11", x: 313, y: 110, label: "L1-K11" },
      { id: "P008", x: 112, y: 300, label: "P008" },
      { id: "P009", x: 130, y: 300, label: "P009" },
      { id: "C04", x: 340, y: 300, label: "L1-C04" },
      { id: "C05", x: 348, y: 305, label: "L1-C05" },
    ])
    const placed = layoutPointMapMarkers(original)
    expect(placed.map((point) => point.id)).toEqual(original.markers.map((point) => point.id))
    expect(placed.some((point) => point.displaced)).toBe(true)
    for (const point of placed) {
      const anchor = original.markers.find((marker) => marker.id === point.id)!
      expect({ x: point.anchorX, y: point.anchorY }).toEqual({ x: anchor.x, y: anchor.y })
      expect(Math.hypot(point.x - point.anchorX, point.y - point.anchorY)).toBeLessThanOrEqual(original.radius * 8 + 1e-6)
    }
    expectNoOverlaps(placed, original.radius)
  })

  it("moves or repositions labels when circles alone fit but the default labels would cover another circle", () => {
    const original = input([
      { id: "a", x: 200, y: 100, label: "K01-长型号" },
      { id: "b", x: 200, y: 160, label: "K02" },
    ])
    const placed = layoutPointMapMarkers(original)
    expectNoOverlaps(placed, original.radius)
    expect(placed).toHaveLength(2)
  })

  it("keeps long boundary labels and exterior camera circles inside the available drawing margin", () => {
    const original = input([
      { id: "left-camera", x: 24, y: 28, label: "L1-CAM-左侧室外摄像头" },
      { id: "right-camera", x: 576, y: 470, label: "L1-CAM-右侧室外摄像头" },
    ])
    const placed = layoutPointMapMarkers(original)
    for (const point of placed) {
      expect(point.x - original.radius).toBeGreaterThanOrEqual(0)
      expect(point.x + original.radius).toBeLessThanOrEqual(600)
      expect(point.y - original.radius).toBeGreaterThanOrEqual(0)
      expect(point.y + original.radius).toBeLessThanOrEqual(500)
      expect(point.labelX).toBeGreaterThanOrEqual(0)
      expect(point.labelX + point.labelWidth).toBeLessThanOrEqual(600)
      expect(point.labelY).toBeGreaterThanOrEqual(0)
      expect(point.labelY + point.labelHeight).toBeLessThanOrEqual(500)
    }
    expectNoOverlaps(placed, original.radius)
  })

  it("is deterministic and never changes source coordinates or marker order", () => {
    const original = input([{ id: "a", x: 80, y: 80, label: "K01" }, { id: "b", x: 81, y: 81, label: "K02" }, { id: "c", x: 83, y: 80, label: "K03" }])
    const before = structuredClone({ markers: original.markers, bounds: original.bounds })
    const first = layoutPointMapMarkers(original)
    expect(layoutPointMapMarkers(original)).toEqual(first)
    expect({ markers: original.markers, bounds: original.bounds }).toEqual(before)
  })

  it("reserves later isolated installation anchors rather than moving a crowded marker over them", () => {
    const original = input([
      { id: "crowded-a", x: 100, y: 100, label: "A" },
      { id: "crowded-b", x: 103, y: 100, label: "B" },
      { id: "isolated", x: 160, y: 100, label: "C" },
    ])
    const placed = layoutPointMapMarkers(original)
    expect(placed.find((point) => point.id === "isolated")).toMatchObject({ x: 160, y: 100, displaced: false })
    expectNoOverlaps(placed, original.radius)
  })

  it("reports an impossible arrangement instead of dropping circles or clipping a long label", () => {
    expect(() => layoutPointMapMarkers({ ...input([{ id: "a", x: 25, y: 25, label: "A" }]), bounds: { left: 0, top: 0, width: 44, height: 44 } })).toThrow("排布")
    expect(() => layoutPointMapMarkers({ ...input([{ id: "a", x: 100, y: 100, label: "长标签" }]), labelWidth: () => 1000 })).toThrow("标签")
  })

  it("rejects invalid geometry and duplicated identities before arranging", () => {
    expect(() => layoutPointMapMarkers({ ...input([]), radius: 0 })).toThrow()
    expect(() => layoutPointMapMarkers(input([{ id: "a", x: NaN, y: 5, label: "A" }]))).toThrow()
    expect(() => layoutPointMapMarkers(input([{ id: "a", x: 50, y: 50, label: "A" }, { id: "a", x: 80, y: 80, label: "B" }]))).toThrow()
  })
})
