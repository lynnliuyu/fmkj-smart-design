import { describe, expect, it } from "vitest"

import {
  accountTypeForPlan,
  defaultPlanLimits,
  defaultSubscriptionStatusForPlan,
  isEnterprisePlanCode,
  normalizePlanLimits,
  roleForAccountType,
  validatePlanUpdateFields,
} from "../lib/account-plan-policy.js"

describe("platform admin plan limits", () => {
  it("keeps free accounts limited to one project with no point map", () => {
    expect(defaultPlanLimits.FREE).toMatchObject({
      canCreateSubAccounts: false,
      canCreateTeam: false,
      canUsePointMap: false,
      maxMembers: 0,
      maxProjects: 1,
      supportLevel: "standard",
    })
  })

  it("allows personal pro point maps without team or sub-accounts", () => {
    expect(defaultPlanLimits.PERSONAL_PRO_MONTHLY).toMatchObject({
      canCreateSubAccounts: false,
      canCreateTeam: false,
      canUsePointMap: true,
      maxMembers: 0,
      maxProjects: null,
      supportLevel: "priority",
    })
  })

  it("allows enterprise plans to create teams and sub-accounts", () => {
    expect(defaultPlanLimits.ENTERPRISE_MONTHLY).toMatchObject({
      canCreateSubAccounts: true,
      canCreateTeam: true,
      canUsePointMap: true,
      maxMembers: 20,
      maxProjects: null,
      supportLevel: "enterprise",
    })
  })

  it("normalizes partial persisted limits against the plan defaults", () => {
    expect(normalizePlanLimits("FREE", { storageLimitMb: 500 })).toMatchObject({
      canUseAdvancedExport: false,
      canUsePointMap: false,
      maxProjects: 1,
      storageLimitMb: 500,
      supportLevel: "standard",
    })
  })

  it("distinguishes enterprise plans for organization subscriptions", () => {
    expect(isEnterprisePlanCode("ENTERPRISE_MONTHLY")).toBe(true)
    expect(isEnterprisePlanCode("ENTERPRISE_YEARLY")).toBe(true)
    expect(isEnterprisePlanCode("ENTERPRISE_CUSTOM")).toBe(true)
    expect(isEnterprisePlanCode("FREE")).toBe(false)
    expect(isEnterprisePlanCode("PERSONAL_PRO_MONTHLY")).toBe(false)
  })

  it("derives account profile and subscription defaults from plan code", () => {
    expect(accountTypeForPlan("FREE")).toBe("PERSONAL_FREE")
    expect(accountTypeForPlan("PERSONAL_PRO_MONTHLY")).toBe("PERSONAL_PRO")
    expect(accountTypeForPlan("ENTERPRISE_MONTHLY")).toBe("ENTERPRISE_OWNER")
    expect(defaultSubscriptionStatusForPlan("FREE")).toBe("free")
    expect(defaultSubscriptionStatusForPlan("ENTERPRISE_YEARLY")).toBe("active")
    expect(roleForAccountType("ENTERPRISE_OWNER")).toBe("manager")
    expect(roleForAccountType("PERSONAL_FREE")).toBe("member")
  })

  it("validates plan update fields without touching SQL adapters", () => {
    expect(
      validatePlanUpdateFields({
        limits: {
          ...defaultPlanLimits.FREE,
          maxProjects: -1,
        },
        name: "",
        planId: "",
        priceCents: -10,
      })
    ).toMatchObject({
      maxProjects: "项目数量上限 必须为空或非负整数",
      name: "请填写套餐名称",
      planId: "套餐不存在",
      priceCents: "价格必须是非负整数",
    })
  })
})
