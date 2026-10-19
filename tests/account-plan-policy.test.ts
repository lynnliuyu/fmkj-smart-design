import { describe, expect, it } from "vitest"

import {
  accountTypeForPlan,
  defaultPlanLimits,
  defaultSubscriptionStatusForPlan,
  isEnterprisePlanCode,
  isPlanCode,
  isSubscriptionStatus,
  normalizePlanLimits,
  roleForAccountType,
  validatePlanUpdateFields,
} from "../lib/account-plan-policy"
import type { PlanCode } from "../lib/account-system/domain"

const allPlanCodes: PlanCode[] = [
  "FREE",
  "PERSONAL_PRO_MONTHLY",
  "PERSONAL_PRO_YEARLY",
  "ENTERPRISE_MONTHLY",
  "ENTERPRISE_YEARLY",
  "ENTERPRISE_CUSTOM",
]

describe("plan limits", () => {
  it("keeps every plan code in the default table", () => {
    for (const code of allPlanCodes) {
      expect(defaultPlanLimits[code], code).toBeTruthy()
      expect(defaultPlanLimits[code].supportLevel, code).toBeTruthy()
    }
    expect(Object.keys(defaultPlanLimits).sort()).toEqual([...allPlanCodes].sort())
  })

  it("only lets paid plans use point maps and advanced export", () => {
    expect(defaultPlanLimits.FREE.canUsePointMap).toBe(false)
    expect(defaultPlanLimits.FREE.canUseAdvancedExport).toBe(false)
    expect(defaultPlanLimits.FREE.maxProjects).toBe(1)

    for (const code of allPlanCodes.filter((item) => item !== "FREE")) {
      expect(defaultPlanLimits[code].canUsePointMap, code).toBe(true)
      expect(defaultPlanLimits[code].canUseAdvancedExport, code).toBe(true)
      expect(defaultPlanLimits[code].maxProjects, code).toBeNull()
    }
  })

  it("only enterprise plans allow sub accounts and teams, with a member cap", () => {
    for (const code of allPlanCodes) {
      const limits = defaultPlanLimits[code]
      const enterprise = isEnterprisePlanCode(code)

      expect(limits.canCreateTeam, code).toBe(enterprise)
      expect(limits.canCreateSubAccounts, code).toBe(enterprise)
      if (!enterprise) expect(limits.maxMembers, code).toBe(0)
    }

    expect(defaultPlanLimits.ENTERPRISE_MONTHLY.maxMembers).toBe(20)
    expect(defaultPlanLimits.ENTERPRISE_YEARLY.maxMembers).toBe(20)
    expect(defaultPlanLimits.ENTERPRISE_CUSTOM.maxMembers).toBeNull()
  })

  it("overrides stored limits but keeps the default support level", () => {
    const limits = normalizePlanLimits("ENTERPRISE_MONTHLY", {
      maxMembers: 5,
      storageLimitMb: 512,
    })

    expect(limits.maxMembers).toBe(5)
    expect(limits.storageLimitMb).toBe(512)
    expect(limits.supportLevel).toBe("enterprise")
    expect(limits.canUsePointMap).toBe(true)
  })

  it("accepts an explicit support level when a stored plan overrides it", () => {
    expect(
      normalizePlanLimits("FREE", { supportLevel: "dedicated" }).supportLevel,
    ).toBe("dedicated")
  })

  it("returns the defaults when a plan has no stored limits", () => {
    expect(normalizePlanLimits("PERSONAL_PRO_MONTHLY")).toEqual(
      defaultPlanLimits.PERSONAL_PRO_MONTHLY,
    )
  })
})

describe("plan identity", () => {
  it("recognises known plan codes only", () => {
    for (const code of allPlanCodes) expect(isPlanCode(code)).toBe(true)
    expect(isPlanCode("PERSONAL_LITE")).toBe(false)
    expect(isPlanCode("")).toBe(false)
  })

  it("treats only enterprise codes as enterprise", () => {
    expect(allPlanCodes.filter(isEnterprisePlanCode)).toEqual([
      "ENTERPRISE_MONTHLY",
      "ENTERPRISE_YEARLY",
      "ENTERPRISE_CUSTOM",
    ])
  })

  it("maps a plan to its account type and role", () => {
    expect(accountTypeForPlan("FREE")).toBe("PERSONAL_FREE")
    expect(accountTypeForPlan("PERSONAL_PRO_MONTHLY")).toBe("PERSONAL_PRO")
    expect(accountTypeForPlan("PERSONAL_PRO_YEARLY")).toBe("PERSONAL_PRO")
    expect(accountTypeForPlan("ENTERPRISE_YEARLY")).toBe("ENTERPRISE_OWNER")

    expect(roleForAccountType("SUPER_ADMIN")).toBe("admin")
    expect(roleForAccountType("ENTERPRISE_OWNER")).toBe("manager")
    expect(roleForAccountType("ENTERPRISE_MEMBER")).toBe("member")
    expect(roleForAccountType("PERSONAL_FREE")).toBe("member")
  })

  it("starts free subscriptions as free and paid ones as active", () => {
    expect(defaultSubscriptionStatusForPlan("FREE")).toBe("free")
    for (const code of allPlanCodes.filter((item) => item !== "FREE")) {
      expect(defaultSubscriptionStatusForPlan(code), code).toBe("active")
    }
  })

  it("recognises every subscription status the database can hold", () => {
    for (const status of [
      "free",
      "active",
      "grace_period",
      "past_due",
      "expired",
      "canceled",
    ]) {
      expect(isSubscriptionStatus(status), status).toBe(true)
    }
    expect(isSubscriptionStatus("trialing")).toBe(false)
  })
})

describe("plan update validation", () => {
  const limits = normalizePlanLimits("ENTERPRISE_MONTHLY")

  it("accepts a complete plan update", () => {
    expect(
      validatePlanUpdateFields({
        limits,
        name: "企业版（月付）",
        planId: "plan_1",
        priceCents: 19900,
      }),
    ).toEqual({})
  })

  it("rejects a missing plan, blank name and a negative or fractional price", () => {
    const missing = validatePlanUpdateFields({
      limits,
      name: "  ",
      planId: "",
      priceCents: -1,
    })

    expect(missing.planId).toBe("套餐不存在")
    expect(missing.name).toBe("请填写套餐名称")
    expect(missing.priceCents).toBe("价格必须是非负整数")

    expect(
      validatePlanUpdateFields({
        limits,
        name: "企业版",
        planId: "plan_1",
        priceCents: 12.5,
      }).priceCents,
    ).toBe("价格必须是非负整数")
  })

  it("allows zero price for a free plan", () => {
    expect(
      validatePlanUpdateFields({
        limits: normalizePlanLimits("FREE"),
        name: "免费版",
        planId: "plan_free",
        priceCents: 0,
      }),
    ).toEqual({})
  })

  it("rejects negative or fractional limits and names the offending field", () => {
    const details = validatePlanUpdateFields({
      limits: { ...limits, maxMembers: -1, maxProjects: 2.5, storageLimitMb: -10 },
      name: "企业版",
      planId: "plan_1",
      priceCents: 100,
    })

    expect(details.maxMembers).toBe("成员数量上限 必须为空或非负整数")
    expect(details.maxProjects).toBe("项目数量上限 必须为空或非负整数")
    expect(details.storageLimitMb).toBe("存储上限 必须为空或非负整数")
  })

  it("treats null limits as unlimited instead of invalid", () => {
    expect(
      validatePlanUpdateFields({
        limits: normalizePlanLimits("ENTERPRISE_CUSTOM"),
        name: "企业定制版",
        planId: "plan_1",
        priceCents: 0,
      }),
    ).toEqual({})
  })
})
