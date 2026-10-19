import { describe, expect, it } from "vitest"

import {
  applyFeatureFlagLimitsToPermissions,
  applySubscriptionStatusToPermissions,
  basePermissionsForAccount,
  checkAccountPermission,
  checkPlanLimit,
  isWritePermission,
} from "../lib/permission-policy.js"
import type { PlanLimits } from "../lib/account-system/domain.js"

const freeLimits: PlanLimits = {
  canCreateSubAccounts: false,
  canCreateTeam: false,
  canUseAdvancedExport: false,
  canUsePointMap: false,
  maxMembers: 0,
  maxProjects: 1,
  storageLimitMb: 200,
  supportLevel: "standard",
}

describe("permission policy", () => {
  it("centralizes write permission classification", () => {
    expect(isWritePermission("project.create")).toBe(true)
    expect(isWritePermission("point_map.use")).toBe(false)
    expect(isWritePermission("project.view")).toBe(false)
    expect(isWritePermission("order.view")).toBe(false)
  })

  it("keeps read access but removes writes during grace period", () => {
    const permissions = applySubscriptionStatusToPermissions(
      basePermissionsForAccount("ENTERPRISE_OWNER", "active"),
      "grace_period"
    )

    expect(permissions.has("project.view")).toBe(true)
    expect(permissions.has("project.create")).toBe(false)
    expect(permissions.has("enterprise.manage_members")).toBe(false)
    expect(permissions.has("point_map.use")).toBe(true)
  })

  it("removes paid capabilities for expired subscriptions", () => {
    const permissions = applySubscriptionStatusToPermissions(
      basePermissionsForAccount("ENTERPRISE_OWNER", "active"),
      "expired"
    )

    expect(permissions.has("project.view")).toBe(true)
    expect(permissions.has("point_map.use")).toBe(false)
    expect(permissions.has("export.advanced")).toBe(false)
    expect(permissions.has("enterprise.manage_billing")).toBe(false)
  })

  it("uses plan limits for project and point map denials", () => {
    expect(
      checkPlanLimit({
        activeProjectCount: 1,
        limits: freeLimits,
        ownerKnown: true,
        permission: "project.create",
      })
    ).toEqual({ allowed: false, reason: "PROJECT_LIMIT_REACHED" })

    expect(checkPlanLimit({ limits: freeLimits, permission: "point_map.use" })).toEqual({
      allowed: false,
      reason: "POINT_MAP_NOT_INCLUDED",
    })
  })

  it("applies platform feature flags to derived permission sets", () => {
    const permissions = applyFeatureFlagLimitsToPermissions(
      basePermissionsForAccount("ENTERPRISE_OWNER", "active"),
      ["point_map", "advanced_export", "enterprise_team"]
    )

    expect(permissions.has("project.view")).toBe(true)
    expect(permissions.has("point_map.use")).toBe(false)
    expect(permissions.has("export.advanced")).toBe(false)
    expect(permissions.has("enterprise.manage_members")).toBe(false)
  })

  it("maps missing permissions to domain denial reasons", () => {
    expect(
      checkAccountPermission(
        {
          accountStatus: "active",
          permissions: ["project.view"],
        },
        "point_map.use"
      )
    ).toEqual({ allowed: false, reason: "POINT_MAP_NOT_INCLUDED" })
  })
})
