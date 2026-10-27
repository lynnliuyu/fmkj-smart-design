import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ context: vi.fn(), query: vi.fn() }))
vi.mock("@/lib/server-db", () => ({ getPool: () => ({ query: mocks.query }) }))
vi.mock("@/lib/account-context", async (original) => ({ ...await original<typeof import("../lib/account-context")>(), getCurrentAccountContext: mocks.context }))

import { buildAccountContext } from "../lib/account-context"
import { GET } from "../app/api/activities/route"

const user = { userId: "10000000-0000-0000-0000-000000000001", role: "designer", name: "A" }
beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue(buildAccountContext(user))
  mocks.query.mockReset().mockResolvedValue({ rows: [] })
})

describe("activities follow project visibility", () => {
  it("limits both persisted activity and fallback activity to visible projects", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(mocks.query).toHaveBeenCalledTimes(3)
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toContain("p.deleted_at is null")
      expect(sql).toContain("coalesce(p.owner_type, 'user') = 'user'")
      expect(params).toEqual([user.userId])
    }
    expect(mocks.query.mock.calls[0][0]).toContain("join projects p on p.id = case")
  })

  it("applies project assignment visibility to enterprise members", async () => {
    mocks.context.mockResolvedValue(buildAccountContext(user, { id: user.userId, role: "editor", status: "active" }, { id: "org_1", name: "Org", role: "editor" }))
    await GET()
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toContain("from project_members pm")
      expect(params).toEqual(["org_1", user.userId])
    }
  })

  it("retains product update events for administrators only", async () => {
    await GET()
    expect(mocks.query.mock.calls[0][0]).not.toContain("or al.entity_type = 'product'")
    mocks.query.mockClear()
    mocks.context.mockResolvedValue(buildAccountContext({ ...user, role: "admin" }))
    await GET()
    expect(mocks.query.mock.calls[0][0]).toContain("or al.entity_type = 'product'")
  })

  it("rejects a disabled account before reading activity", async () => {
    mocks.context.mockResolvedValue(buildAccountContext(user, { id: user.userId, status: "disabled" }))
    expect((await GET()).status).toBe(403)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
