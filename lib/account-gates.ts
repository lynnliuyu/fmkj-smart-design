import type { AccountContext } from "./account-context"
import type { DenialReason, PermissionCode } from "./account-system/domain"
import { checkAccountPermission } from "./permission-policy"

export type GateResult = { allowed: true } | { allowed: false; reason: DenialReason }

export function requireAccountPermission(
  context: AccountContext | null,
  permission: PermissionCode
): GateResult {
  return checkAccountPermission(
    context
      ? {
          accountStatus: context.account.status,
          permissions: context.permissions,
          subscriptionStatus: context.account.subscriptionStatus,
        }
      : null,
    permission
  ) as GateResult
}

export function canCreatePersonalProject(
  context: AccountContext | null,
  activeProjectCount: number
): GateResult {
  const permission = requireAccountPermission(context, "project.create")

  if (!permission.allowed) return permission
  if (context?.account.type === "PERSONAL_FREE" && activeProjectCount >= 1) {
    return deny("PROJECT_LIMIT_REACHED")
  }

  return { allowed: true }
}

function deny(reason: DenialReason): GateResult {
  return { allowed: false, reason }
}
