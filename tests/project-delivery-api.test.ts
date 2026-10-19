import { describe, expect, it, vi } from "vitest"

import { createProjectDeliveryApiHandlers } from "../lib/project-delivery-api"
import { ProjectDeliveryError } from "../lib/project-delivery-service"
import { PointMapServiceError } from "../lib/point-map-service"

const projectId = "11111111-1111-4111-8111-111111111111"
const deliveryId = "22222222-2222-4222-8222-222222222222"
const context = { params: Promise.resolve({ id: projectId, deliveryId }) }

describe("project delivery HTTP boundaries", () => {
  it("dispatches GET list, read-only preview, POST create and historical detail separately", async () => {
    const dependencies = {
      getContext: vi.fn(async () => null),
      list: vi.fn(async () => [{ id: deliveryId, version: 1 }]) as never,
      preview: vi.fn(async () => ({ id: null, version: 0 })) as never,
      create: vi.fn(async () => ({ id: deliveryId, version: 1 })) as never,
      read: vi.fn(async () => ({ id: deliveryId, version: 1 })) as never,
    }
    const handlers = createProjectDeliveryApiHandlers(dependencies)
    const list = await handlers.GET(new Request(`http://local/api/projects/${projectId}/deliveries`), context)
    expect(await list.json()).toEqual({ data: [{ id: deliveryId, version: 1 }] })
    expect(list.headers.get("cache-control")).toBe("private, no-store")
    expect(await (await handlers.GET(new Request(`http://local/api/projects/${projectId}/deliveries?preview=1`), context)).json()).toEqual({ data: { id: null, version: 0 } })
    expect(await (await handlers.POST(new Request("http://local", { method: "POST" }), context)).json()).toEqual({ data: { id: deliveryId, version: 1 } })
    expect(await (await handlers.DETAIL(new Request("http://local"), context)).json()).toEqual({ data: { id: deliveryId, version: 1 } })
    expect(dependencies.list).toHaveBeenCalledWith(null, projectId)
    expect(dependencies.preview).toHaveBeenCalledWith(null, projectId)
    expect(dependencies.create).toHaveBeenCalledWith(null, projectId)
    expect(dependencies.read).toHaveBeenCalledWith(null, projectId, deliveryId)
  })

  it("returns actionable source issues and hides database diagnostics", async () => {
    const conflict = createProjectDeliveryApiHandlers({ getContext: async () => null, create: async () => { throw new ProjectDeliveryError("DELIVERY_SOURCE_CONFLICT", 409, "请核对", ["K01 数量不一致"]) } })
    const result = await conflict.POST(new Request("http://local", { method: "POST" }), context)
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ code: "DELIVERY_SOURCE_CONFLICT", error: "请核对", issues: ["K01 数量不一致"] })
    const unavailable = createProjectDeliveryApiHandlers({ getContext: async () => null, list: async () => { throw new Error("secret connection details") } })
    const hidden = await unavailable.GET(new Request("http://local"), context)
    expect(hidden.status).toBe(503)
    expect(await hidden.json()).toEqual({ error: "POINT_MAP_UNAVAILABLE" })
  })

  it("preserves unauthenticated and hidden-resource status codes", async () => {
    for (const [code, status] of [["NOT_AUTHENTICATED", 401], ["RESOURCE_NOT_FOUND_OR_NOT_OWNED", 404]] as const) {
      const handlers = createProjectDeliveryApiHandlers({ getContext: async () => null, read: async () => { throw new PointMapServiceError(code, status) } })
      const response = await handlers.DETAIL(new Request("http://local"), context)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: code })
    }
  })
})
