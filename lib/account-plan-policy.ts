import type { AccountType, PlanCode, PlanLimits, SubscriptionStatus } from "./account-system/domain"

export type PlanValidationDetails = Record<string, string>

export const defaultPlanLimits: Record<PlanCode, PlanLimits> = {
  ENTERPRISE_CUSTOM: {
    canCreateSubAccounts: true,
    canCreateTeam: true,
    canUseAdvancedExport: true,
    canUsePointMap: true,
    maxMembers: null,
    maxProjects: null,
    storageLimitMb: null,
    supportLevel: "dedicated",
  },
  ENTERPRISE_MONTHLY: {
    canCreateSubAccounts: true,
    canCreateTeam: true,
    canUseAdvancedExport: true,
    canUsePointMap: true,
    maxMembers: 20,
    maxProjects: null,
    storageLimitMb: 10240,
    supportLevel: "enterprise",
  },
  ENTERPRISE_YEARLY: {
    canCreateSubAccounts: true,
    canCreateTeam: true,
    canUseAdvancedExport: true,
    canUsePointMap: true,
    maxMembers: 20,
    maxProjects: null,
    storageLimitMb: 10240,
    supportLevel: "enterprise",
  },
  FREE: {
    canCreateSubAccounts: false,
    canCreateTeam: false,
    canUseAdvancedExport: false,
    canUsePointMap: false,
    maxMembers: 0,
    maxProjects: 1,
    storageLimitMb: 200,
    supportLevel: "standard",
  },
  PERSONAL_PRO_MONTHLY: {
    canCreateSubAccounts: false,
    canCreateTeam: false,
    canUseAdvancedExport: true,
    canUsePointMap: true,
    maxMembers: 0,
    maxProjects: null,
    storageLimitMb: 2048,
    supportLevel: "priority",
  },
  PERSONAL_PRO_YEARLY: {
    canCreateSubAccounts: false,
    canCreateTeam: false,
    canUseAdvancedExport: true,
    canUsePointMap: true,
    maxMembers: 0,
    maxProjects: null,
    storageLimitMb: 2048,
    supportLevel: "priority",
  },
}

export function normalizePlanLimits(planCode: PlanCode, limits: Partial<PlanLimits> = {}): PlanLimits {
  return {
    ...defaultPlanLimits[planCode],
    ...limits,
    supportLevel: limits.supportLevel ?? defaultPlanLimits[planCode].supportLevel,
  }
}

export function isPlanCode(value: string): value is PlanCode {
  return [
    "FREE",
    "PERSONAL_PRO_MONTHLY",
    "PERSONAL_PRO_YEARLY",
    "ENTERPRISE_MONTHLY",
    "ENTERPRISE_YEARLY",
    "ENTERPRISE_CUSTOM",
  ].includes(value)
}

export function isEnterprisePlanCode(value: PlanCode) {
  return value === "ENTERPRISE_MONTHLY" || value === "ENTERPRISE_YEARLY" || value === "ENTERPRISE_CUSTOM"
}

export function accountTypeForPlan(planCode: PlanCode): AccountType {
  if (planCode === "FREE") return "PERSONAL_FREE"
  if (planCode.startsWith("PERSONAL_PRO")) return "PERSONAL_PRO"
  return "ENTERPRISE_OWNER"
}

export function roleForAccountType(accountType: AccountType) {
  if (accountType === "SUPER_ADMIN") return "admin"
  if (accountType === "ENTERPRISE_OWNER") return "manager"
  return "member"
}

export function defaultSubscriptionStatusForPlan(planCode: PlanCode): SubscriptionStatus {
  return planCode === "FREE" ? "free" : "active"
}

export function validatePlanUpdateFields(input: {
  limits: PlanLimits
  name: string
  planId: string
  priceCents: number
}): PlanValidationDetails {
  const details: PlanValidationDetails = {}

  if (!input.planId) details.planId = "套餐不存在"
  if (!input.name.trim()) details.name = "请填写套餐名称"
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    details.priceCents = "价格必须是非负整数"
  }
  if (!input.limits || typeof input.limits !== "object") {
    details.limits = "请填写套餐限制"
  } else {
    validateNullableInteger(details, "maxProjects", input.limits.maxProjects)
    validateNullableInteger(details, "maxMembers", input.limits.maxMembers)
    validateNullableInteger(details, "storageLimitMb", input.limits.storageLimitMb)
  }

  return details
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return ["free", "active", "grace_period", "past_due", "expired", "canceled"].includes(value)
}

function validateNullableInteger(details: PlanValidationDetails, key: string, value: number | null) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    details[key] = `${planLimitFieldLabels[key] ?? key} 必须为空或非负整数`
  }
}

const planLimitFieldLabels: Record<string, string> = {
  maxMembers: "成员数量上限",
  maxProjects: "项目数量上限",
  storageLimitMb: "存储上限",
}
