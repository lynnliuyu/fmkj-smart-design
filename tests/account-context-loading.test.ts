import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), hasDatabaseUrl: vi.fn() }))
vi.mock("../lib/auth", () => ({ getSessionUser: mocks.session }))
vi.mock("../lib/server-db", () => ({ getPool: () => ({ query: mocks.query }), hasDatabaseUrl: mocks.hasDatabaseUrl }))

import { getCurrentAccountContext } from "../lib/account-context"

const user = { userId: "10000000-0000-0000-0000-000000000001", role: "admin", name: "Admin" }

beforeEach(() => {
  vi.unstubAllEnvs()
  mocks.session.mockReset().mockResolvedValue(user)
  mocks.query.mockReset()
  mocks.hasDatabaseUrl.mockReset().mockReturnValue(true)
})

describe("loading current account authority", () => {
  it("does not restore cookie administrator privileges when the account was removed", async () => {
    mocks.query.mockResolvedValue({ rows: [] })
    expect(await getCurrentAccountContext()).toBeNull()
  })

  it("does not restore cookie administrator privileges when the database query fails", async () => {
    mocks.query.mockRejectedValue(new Error("temporary database failure"))
    expect(await getCurrentAccountContext()).toBeNull()
  })

  it("uses the current lower role rather than the role in the cookie", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: user.userId, role: "member", status: "active" }] })
    expect((await getCurrentAccountContext())?.account.type).toBe("PERSONAL_FREE")
  })

  it("keeps a disabled user disabled even when their account profile is active", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: user.userId, role: "admin", status: "inactive", account_status: "active", account_type: "SUPER_ADMIN" }] })
    expect(await getCurrentAccountContext()).toMatchObject({ account: { status: "disabled" }, permissions: [] })
  })

  it("retains an expired organization scope and removes writes even without a plan row", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: user.userId, role: "owner", status: "active", account_status: "active", account_type: "ENTERPRISE_OWNER", organization_id: "org_1", organization_name: "Expired Org", organization_status: "expired", subscription_status: "expired" }] })
    const current = await getCurrentAccountContext()
    expect(current?.organization?.id).toBe("org_1")
    expect(current?.account.subscriptionStatus).toBe("expired")
    expect(current?.permissions).toContain("project.view")
    expect(current?.permissions).not.toContain("project.edit")
  })

  it.each(["disabled", "deleted"])("rejects enterprise permissions when organization is %s", async (status) => {
    mocks.query.mockResolvedValue({ rows: [{ id: user.userId, role: "owner", status: "active", account_status: "active", account_type: "ENTERPRISE_OWNER", organization_id: "org_1", organization_name: "Org", organization_status: status }] })
    expect(await getCurrentAccountContext()).toMatchObject({ account: { status: "disabled" }, permissions: [] })
  })

  it("allows only the explicit local development account to work without a database", async () => {
    vi.stubEnv("NODE_ENV", "development")
    mocks.hasDatabaseUrl.mockReturnValue(false)
    mocks.session.mockResolvedValue({ ...user, userId: "local-admin" })
    expect((await getCurrentAccountContext())?.account.isSuperAdmin).toBe(true)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue(user)
    mocks.query.mockResolvedValue({ rows: [] })
    expect(await getCurrentAccountContext()).toBeNull()
  })
})
