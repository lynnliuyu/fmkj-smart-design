import { describe, expect, it } from "vitest"

import {
  canCreatePersonalProject,
  requireAccountPermission,
} from "../lib/account-gates.js"
import { buildAccountContext } from "../lib/account-context.js"
import type { AuthUser } from "../lib/auth.js"

const sessionUser: AuthUser = {
  email: "lynn@example.com",
  name: "Lynn",
  phone: null,
  role: "member",
  userId: "user_1",
}

describe("phase one account gates", () => {
  it("blocks personal free users from creating a second active project", () => {
    const context = buildAccountContext(sessionUser)

    expect(canCreatePersonalProject(context, 1)).toEqual({
      allowed: false,
      reason: "PROJECT_LIMIT_REACHED",
    })
  })

  it("allows personal free users to create their first project", () => {
    const context = buildAccountContext(sessionUser)

    expect(canCreatePersonalProject(context, 0)).toEqual({ allowed: true })
  })

  it("blocks personal free users from point maps", () => {
    const context = buildAccountContext(sessionUser)

    expect(requireAccountPermission(context, "point_map.use")).toEqual({
      allowed: false,
      reason: "POINT_MAP_NOT_INCLUDED",
    })
  })

  it("allows personal pro users to create multiple projects and use point maps", () => {
    const context = buildAccountContext(sessionUser, {
      account_status: "active",
      account_type: "PERSONAL_PRO",
      id: "user_1",
      plan_code: "PERSONAL_PRO_MONTHLY",
      plan_limits: {
        canUseAdvancedExport: true,
        canUsePointMap: true,
        maxProjects: null,
      },
      role: "member",
      status: "active",
      subscription_status: "active",
    })

    expect(canCreatePersonalProject(context, 3)).toEqual({ allowed: true })
    expect(requireAccountPermission(context, "point_map.use")).toEqual({ allowed: true })
  })

  it("allows super admins to manage all accounts", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "admin",
      status: "active",
    })

    expect(requireAccountPermission(context, "account.manage_all")).toEqual({ allowed: true })
  })

  it("returns subscription expired for enterprise writes during grace period", () => {
    const context = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_OWNER",
        id: "user_1",
        plan_code: "ENTERPRISE_MONTHLY",
        plan_limits: {
          canCreateTeam: true,
          canUseAdvancedExport: true,
          canUsePointMap: true,
        },
        role: "owner",
        status: "active",
        subscription_status: "grace_period",
      },
      { id: "org_1", name: "鏂规槑绉戞妧", role: "管理员" }
    )

    expect(requireAccountPermission(context, "project.view")).toEqual({ allowed: true })
    expect(requireAccountPermission(context, "project.create")).toEqual({
      allowed: false,
      reason: "SUBSCRIPTION_EXPIRED",
    })
    expect(requireAccountPermission(context, "enterprise.manage_members")).toEqual({
      allowed: false,
      reason: "SUBSCRIPTION_EXPIRED",
    })
  })
})
