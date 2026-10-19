import { describe, expect, it, vi } from "vitest"

import { buildAccountContext } from "../lib/account-context"
import { createPointMapApiHandlers, pointMapApiErrorResponse } from "../lib/point-map-api"
import { MAX_POINT_MAP_REQUEST_BYTES, PointMapServiceError } from "../lib/point-map-service"

const context = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
const account = buildAccountContext({ userId: "22222222-2222-4222-8222-222222222222", name: "Synthetic", role: "pro" })
const payload = { data: null, revision: 0, versions: [] }

describe("point-map API handlers", () => {
  it("returns private responses and forwards confirmed version requests", async () => {
    const read = vi.fn().mockResolvedValue(payload)
    const handlers = createPointMapApiHandlers({ getContext: async () => account, read })
    const response = await handlers.GET(new Request("https://example.test/api/projects/id/point-map?version=3"), context)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual(payload)
    expect(read).toHaveBeenCalledWith(account, "11111111-1111-4111-8111-111111111111", 3)
  })

  it.each(["0", "-1", "1.5", "1e3", "abc", "2147483648", "1&version=2"])("rejects invalid version query %s", async (version) => {
    const read = vi.fn().mockResolvedValue(payload)
    const handlers = createPointMapApiHandlers({ getContext: async () => account, read })
    const response = await handlers.GET(new Request(`https://example.test/api/point-map?version=${version}`), context)
    expect(response.status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })

  it("requires a session before reading the body or touching a design", async () => {
    const save = vi.fn()
    const handlers = createPointMapApiHandlers({ getContext: async () => null, save })
    const response = await handlers.PUT(new Request("https://example.test/api/point-map", { method: "PUT", body: "malformed" }), context)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "NOT_AUTHENTICATED" })
    expect(save).not.toHaveBeenCalled()
  })

  it("accepts JSON and forwards expectedRevision and explicit confirmation", async () => {
    const save = vi.fn().mockResolvedValue(payload)
    const handlers = createPointMapApiHandlers({ getContext: async () => account, save })
    const input = { plan: { projectId: "synthetic" }, expectedRevision: 4, confirm: true }
    const response = await handlers.PUT(new Request("https://example.test/api/point-map", { method: "PUT", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(input) }), context)
    expect(response.status).toBe(200)
    expect(save).toHaveBeenCalledWith(account, "11111111-1111-4111-8111-111111111111", input)
  })

  it("rejects malformed JSON, non-JSON content and declared oversize bodies before saving", async () => {
    const save = vi.fn()
    const handlers = createPointMapApiHandlers({ getContext: async () => account, save })
    const cases: Array<{ headers: Record<string, string>; body: string; status: number }> = [
      { headers: { "Content-Type": "application/json" }, body: "{", status: 400 },
      { headers: { "Content-Type": "text/plain" }, body: "{}", status: 415 },
      { headers: { "Content-Type": "application/json", "Content-Length": String(MAX_POINT_MAP_REQUEST_BYTES + 1) }, body: "{}", status: 413 },
    ]
    for (const request of cases) {
      const response = await handlers.PUT(new Request("https://example.test/api/point-map", { method: "PUT", headers: request.headers, body: request.body }), context)
      expect(response.status).toBe(request.status)
    }
    expect(save).not.toHaveBeenCalled()
  })

  it("limits streamed bodies even without Content-Length", async () => {
    const save = vi.fn()
    const handlers = createPointMapApiHandlers({ getContext: async () => account, save })
    const body = "x".repeat(MAX_POINT_MAP_REQUEST_BYTES + 1)
    const response = await handlers.PUT(new Request("https://example.test/api/point-map", { method: "PUT", headers: { "Content-Type": "application/json" }, body }), context)
    expect(response.status).toBe(413)
    expect(save).not.toHaveBeenCalled()
  })

  it("returns useful conflict details without exposing database diagnostic errors", async () => {
    const conflict = pointMapApiErrorResponse(new PointMapServiceError("POINT_MAP_REVISION_CONFLICT", 409, "POINT_MAP_REVISION_CONFLICT", 8))
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ code: "POINT_MAP_REVISION_CONFLICT", error: "POINT_MAP_REVISION_CONFLICT", revision: 8 })
    const failure = pointMapApiErrorResponse(new Error("private sql and customer address"))
    expect(failure.status).toBe(503)
    await expect(failure.json()).resolves.toEqual({ error: "POINT_MAP_UNAVAILABLE" })
  })
})
