import { describe, expect, it } from "vitest"

import {
  accountContextCan,
  buildAccountContext,
  deriveAccountTypeFromRole,
} from "../lib/account-context.js"
import type { AuthUser } from "../lib/auth.js"

const sessionUser: AuthUser = {
  email: "lynn@example.com",
  name: "Lynn",
  phone: null,
  role: "member",
  userId: "user_1",
}

describe("account context", () => {
  it("maps platform admin roles to super admin context", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      email: "lynn@example.com",
      name: "Lynn",
      role: "admin",
      status: "active",
    })

    expect(context.account).toMatchObject({
      canManageTeam: true,
      canUsePointMap: true,
      isSuperAdmin: true,
      type: "SUPER_ADMIN",
    })
    expect(accountContextCan(context, "account.manage_all")).toBe(true)
  })

  it("treats session-only users as active", () => {
    const context = buildAccountContext({ ...sessionUser, role: "admin" })

    expect(context.account.status).toBe("active")
    expect(accountContextCan(context, "account.manage_all")).toBe(true)
  })

  it("keeps default member users on the personal free tier", () => {
    const context = buildAccountContext(sessionUser)

    expect(context.account).toMatchObject({
      canManageTeam: false,
      canUsePointMap: false,
      isEnterprise: false,
      type: "PERSONAL_FREE",
    })
    expect(accountContextCan(context, "point_map.use")).toBe(false)
  })

  it("uses organization membership as enterprise account context", () => {
    const context = buildAccountContext(
      sessionUser,
      { id: "user_1", role: "viewer", status: "active" },
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(context.account).toMatchObject({
      isEnterprise: true,
      type: "ENTERPRISE_MEMBER",
    })
    expect(context.organization).toEqual({ id: "org_1", name: "Org", role: "admin" })
  })

  it("removes permissions for disabled users", () => {
    const context = buildAccountContext(sessionUser, {
      id: "user_1",
      role: "admin",
      status: "disabled",
    })

    expect(context.account.status).toBe("disabled")
    expect(context.permissions).toEqual([])
    expect(accountContextCan(context, "account.manage_all")).toBe(false)
  })

  it("derives account type from known role aliases", () => {
    expect(deriveAccountTypeFromRole("owner")).toBe("ENTERPRISE_OWNER")
    expect(deriveAccountTypeFromRole("sales")).toBe("PERSONAL_PRO")
    expect(deriveAccountTypeFromRole("member")).toBe("PERSONAL_FREE")
  })

  it("uses persisted account profile over legacy role aliases", () => {
    const context = buildAccountContext(sessionUser, {
      account_status: "active",
      account_type: "ENTERPRISE_OWNER",
      id: "user_1",
      role: "member",
      status: "active",
    })

    expect(context.account.type).toBe("ENTERPRISE_OWNER")
    expect(accountContextCan(context, "enterprise.manage_members")).toBe(true)
  })

  it("applies persisted plan limits to account permissions", () => {
    const context = buildAccountContext(sessionUser, {
      account_status: "active",
      account_type: "PERSONAL_PRO",
      id: "user_1",
      plan_code: "FREE",
      plan_limits: {
        canUseAdvancedExport: false,
        canUsePointMap: false,
      },
      role: "member",
      status: "active",
      subscription_status: "free",
    })

    expect(context.account.type).toBe("PERSONAL_PRO")
    expect(accountContextCan(context, "point_map.use")).toBe(false)
    expect(accountContextCan(context, "export.advanced")).toBe(false)
  })

  it("applies organization plan limits to enterprise contexts", () => {
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
          maxMembers: 20,
        },
        role: "owner",
        status: "active",
        subscription_status: "active",
      },
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(accountContextCan(context, "enterprise.manage_members")).toBe(true)
    expect(accountContextCan(context, "point_map.use")).toBe(true)
  })

  it("uses organization role permissions for enterprise members", () => {
    const viewerContext = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_MEMBER",
        id: "user_1",
        organization_permissions: ["project.view"],
        plan_code: "ENTERPRISE_MONTHLY",
        plan_limits: {
          canCreateTeam: true,
          canUseAdvancedExport: true,
          canUsePointMap: true,
        },
        role: "viewer",
        status: "active",
        subscription_status: "active",
      },
      { id: "org_1", name: "Org", role: "admin" }
    )
    const editorContext = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_MEMBER",
        id: "user_1",
        organization_permissions: ["project.create", "project.edit", "project.view"],
        plan_code: "ENTERPRISE_MONTHLY",
        plan_limits: {
          canCreateTeam: true,
          canUseAdvancedExport: true,
          canUsePointMap: true,
        },
        role: "editor",
        status: "active",
        subscription_status: "active",
      },
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(accountContextCan(viewerContext, "project.view")).toBe(true)
    expect(accountContextCan(viewerContext, "project.create")).toBe(false)
    expect(accountContextCan(viewerContext, "project.edit")).toBe(false)
    expect(accountContextCan(editorContext, "project.create")).toBe(true)
    expect(accountContextCan(editorContext, "project.edit")).toBe(true)
  })

  it("locks enterprise writes during grace period while keeping read access", () => {
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
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(context.account.subscriptionStatus).toBe("grace_period")
    expect(accountContextCan(context, "project.view")).toBe(true)
    expect(accountContextCan(context, "project.create")).toBe(false)
    expect(accountContextCan(context, "project.edit")).toBe(false)
    expect(accountContextCan(context, "enterprise.manage_members")).toBe(false)
    expect(accountContextCan(context, "point_map.use")).toBe(true)
  })

  it("locks paid enterprise capabilities when subscription is expired", () => {
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
        subscription_status: "expired",
      },
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(context.account.subscriptionStatus).toBe("expired")
    expect(accountContextCan(context, "project.view")).toBe(true)
    expect(accountContextCan(context, "project.create")).toBe(false)
    expect(accountContextCan(context, "point_map.use")).toBe(false)
    expect(accountContextCan(context, "export.advanced")).toBe(false)
    expect(accountContextCan(context, "enterprise.manage_members")).toBe(false)
  })

  it("applies disabled platform feature flags to permissions", () => {
    const context = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_OWNER",
        disabled_features: ["point_map", "advanced_export", "enterprise_team"],
        id: "user_1",
        plan_code: "ENTERPRISE_MONTHLY",
        plan_limits: {
          canCreateTeam: true,
          canUseAdvancedExport: true,
          canUsePointMap: true,
        },
        role: "owner",
        status: "active",
        subscription_status: "active",
      },
      { id: "org_1", name: "Org", role: "admin" }
    )

    expect(context.disabledFeatures).toEqual(["point_map", "advanced_export", "enterprise_team"])
    expect(accountContextCan(context, "point_map.use")).toBe(false)
    expect(accountContextCan(context, "export.advanced")).toBe(false)
    expect(accountContextCan(context, "enterprise.manage_members")).toBe(false)
    expect(accountContextCan(context, "project.view")).toBe(true)
  })
})
