import type {
  AccountStatus,
  AccountType,
  DenialReason,
  PermissionCode,
  PermissionResult,
  PlanLimits,
  SubscriptionStatus,
} from "./account-system/domain"

export const accountTypePermissions: Record<AccountType, PermissionCode[]> = {
  ENTERPRISE_MEMBER: ["project.create", "project.edit", "project.view", "point_map.use", "export.advanced"],
  ENTERPRISE_OWNER: [
    "enterprise.manage_members",
    "enterprise.manage_roles",
    "enterprise.manage_billing",
    "project.create",
    "project.edit",
    "project.view",
    "project.delete",
    "point_map.use",
    "export.advanced",
    "order.view",
  ],
  PERSONAL_FREE: ["project.create", "project.edit", "project.view"],
  PERSONAL_PRO: ["project.create", "project.edit", "project.view", "point_map.use", "export.advanced"],
  SUPER_ADMIN: [
    "account.manage_all",
    "platform.manage_features",
    "enterprise.manage_members",
    "enterprise.manage_roles",
    "enterprise.manage_billing",
    "project.create",
    "project.edit",
    "project.view",
    "project.delete",
    "point_map.use",
    "export.advanced",
    "order.view",
  ],
}

export const permissionCodes: PermissionCode[] = [
  "account.manage_all",
  "platform.manage_features",
  "enterprise.manage_members",
  "enterprise.manage_roles",
  "enterprise.manage_billing",
  "project.create",
  "project.edit",
  "project.view",
  "project.delete",
  "point_map.use",
  "export.advanced",
  "order.view",
]

export function isPermissionCode(value: string): value is PermissionCode {
  return permissionCodes.includes(value as PermissionCode)
}

export function isWritePermission(permission: PermissionCode) {
  return (
    permission === "enterprise.manage_members" ||
    permission === "enterprise.manage_roles" ||
    permission === "project.create" ||
    permission === "project.edit" ||
    permission === "project.delete" ||
    permission === "export.advanced"
  )
}

export function basePermissionsForAccount(accountType: AccountType, accountStatus: AccountStatus) {
  if (accountStatus !== "active") return []
  return [...accountTypePermissions[accountType]]
}

export function applyPlanLimitsToPermissions(permissions: Iterable<PermissionCode>, limits: PlanLimits) {
  const next = new Set(permissions)

  if (!limits.canUsePointMap) next.delete("point_map.use")
  if (!limits.canUseAdvancedExport) next.delete("export.advanced")
  if (!limits.canCreateTeam) {
    next.delete("enterprise.manage_members")
    next.delete("enterprise.manage_roles")
  }

  return next
}

export function applySubscriptionStatusToPermissions(
  permissions: Iterable<PermissionCode>,
  subscriptionStatus: SubscriptionStatus | null | undefined
) {
  const next = new Set(permissions)

  if (subscriptionStatus === "grace_period") {
    removeWritePermissions(next)
  }

  if (subscriptionStatus === "expired" || subscriptionStatus === "past_due") {
    removeWritePermissions(next)
    next.delete("point_map.use")
    next.delete("export.advanced")
    next.delete("enterprise.manage_members")
    next.delete("enterprise.manage_roles")
    next.delete("enterprise.manage_billing")
  }

  return next
}

export function applyFeatureFlagLimitsToPermissions(permissions: Iterable<PermissionCode>, disabledFeatures: string[]) {
  const next = new Set(permissions)
  const disabled = new Set(disabledFeatures)

  if (disabled.has("point_map")) next.delete("point_map.use")
  if (disabled.has("advanced_export")) next.delete("export.advanced")
  if (disabled.has("enterprise_team")) {
    next.delete("enterprise.manage_members")
    next.delete("enterprise.manage_roles")
  }

  return next
}

export function checkAccountPermission(
  input: {
    accountStatus: AccountStatus
    permissions: PermissionCode[]
    subscriptionStatus?: SubscriptionStatus | null
  } | null,
  permission: PermissionCode
): PermissionResult {
  if (!input) return deny("NOT_AUTHENTICATED")
  if (input.accountStatus !== "active") return deny("ACCOUNT_DISABLED")

  const subscriptionResult = checkSubscriptionStatus(permission, input.subscriptionStatus)
  if (!subscriptionResult.allowed) return subscriptionResult

  if (!input.permissions.includes(permission)) {
    return deny(defaultDenialForPermission(permission))
  }

  return { allowed: true }
}

export function checkSubscriptionStatus(
  permission: PermissionCode,
  subscriptionStatus: SubscriptionStatus | null | undefined
): PermissionResult {
  if (subscriptionStatus === "expired" || subscriptionStatus === "past_due") {
    return deny("SUBSCRIPTION_EXPIRED")
  }

  if (subscriptionStatus === "grace_period" && isWritePermission(permission)) {
    return deny("SUBSCRIPTION_EXPIRED")
  }

  return { allowed: true }
}

export function checkPlanLimit(
  input: {
    activeProjectCount?: number
    limits: PlanLimits
    ownerKnown?: boolean
    permission: PermissionCode
  }
): PermissionResult {
  const { activeProjectCount, limits, ownerKnown = false, permission } = input

  if (permission === "project.create" && ownerKnown && limits.maxProjects !== null && (activeProjectCount ?? 0) >= limits.maxProjects) {
    return deny("PROJECT_LIMIT_REACHED")
  }

  if (permission === "point_map.use" && !limits.canUsePointMap) {
    return deny("POINT_MAP_NOT_INCLUDED")
  }

  if (
    (permission === "enterprise.manage_members" ||
      permission === "enterprise.manage_roles" ||
      permission === "enterprise.manage_billing") &&
    !limits.canCreateTeam
  ) {
    return deny("TEAM_FEATURE_REQUIRED")
  }

  if (permission === "export.advanced" && !limits.canUseAdvancedExport) {
    return deny("PLAN_REQUIRED")
  }

  return { allowed: true }
}

export function defaultDenialForPermission(permission: PermissionCode): DenialReason {
  if (permission === "point_map.use") return "POINT_MAP_NOT_INCLUDED"
  if (permission === "account.manage_all" || permission === "platform.manage_features") return "PLATFORM_ADMIN_REQUIRED"
  return "ROLE_PERMISSION_DENIED"
}

function removeWritePermissions(permissions: Set<PermissionCode>) {
  for (const permission of permissionCodes) {
    if (isWritePermission(permission)) permissions.delete(permission)
  }
}

function deny(reason: DenialReason): PermissionResult {
  return { allowed: false, reason }
}
