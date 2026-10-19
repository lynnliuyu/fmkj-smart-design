import * as React from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PointMapWorkbench } from "../components/projects/point-map-workbench"

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("projectId=synthetic-project"), useRouter: () => ({ push() {} }) }))
afterEach(() => vi.unstubAllGlobals())

describe("point-map first-render hydration", () => {
  it("does not render the browser's cached draft before mounting", () => {
    const server = renderToString(<PointMapWorkbench />, { identifierPrefix: "hydration-" })
    const stored = JSON.stringify({ projectId: "synthetic-project", schemaVersion: 3, activeFloorId: "floor-1", floorplanName: "", floorplanDataUrl: "", updatedAt: "2026-10-15T00:00:00Z",
      floors: [{ id: "floor-1", name: "只在缓存的楼层", floorplanName: "", floorplanDataUrl: "", imageWidth: 1000, imageHeight: 700 }],
      points: [{ id: "cached-point", name: "只在缓存的点位", room: "只在缓存的房间", iconId: "switch-2", floorId: "floor-1", x: 10, y: 20, placed: true, status: "pending", productId: "", note: "" }], scenes: [] })
    vi.stubGlobal("window", { localStorage: { getItem: () => stored } })
    const clientFirstRender = renderToString(<PointMapWorkbench />, { identifierPrefix: "hydration-" })
    expect(clientFirstRender).toBe(server)
  })
})
