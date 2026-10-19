import { afterEach, describe, expect, it, vi } from "vitest"

import { buildAccountContext, getCurrentAccountContext } from "../lib/account-context.js"
import { AdminAuthError, isSuperAdminContext, requireSuperAdmin } from "../lib/admin-auth.js"
import type { AuthUser } from "../lib/auth.js"

vi.mock("../lib/account-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/account-context.js")>()
  return {
    ...actual,
    getCurrentAccountContext: vi.fn(),
  }
})

const sessionUser: AuthUser = {
  email: "member@example.com",
  name: "Lynn",
  phone: null,
  role: "member",
  userId: "user_1",
}

describe("admin auth", () => {
  afterEach(() => {
    vi.mocked(getCurrentAccountContext).mockReset()
  })

  it("allows active super admins", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "admin",
      status: "active",
    })

    expect(isSuperAdminContext(context)).toBe(true)
  })

  it("denies enterprise owners", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "owner",
      status: "active",
    })

    expect(isSuperAdminContext(context)).toBe(false)
  })

  it("denies personal pro users", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "pro",
      status: "active",
    })

    expect(isSuperAdminContext(context)).toBe(false)
  })

  it("denies personal free users", () => {
    const context = buildAccountContext(sessionUser)

    expect(isSuperAdminContext(context)).toBe(false)
  })

  it("denies disabled super admins", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "admin",
      status: "disabled",
    })

    expect(context.account.isSuperAdmin).toBe(true)
    expect(isSuperAdminContext(context)).toBe(false)
  })

  it("denies missing account context", () => {
    expect(isSuperAdminContext(null)).toBe(false)
  })

  it("rejects non-super-admin sessions from guarded admin APIs", async () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "pro",
      status: "active",
    })
    vi.mocked(getCurrentAccountContext).mockResolvedValue(context)

    await expect(requireSuperAdmin()).rejects.toMatchObject({
      code: "PLATFORM_ADMIN_REQUIRED",
      status: 403,
    } satisfies Partial<AdminAuthError>)
  })
})
