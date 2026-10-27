import type {
  AccountStatus,
  AccountType,
  PermissionCode,
  PlanCode,
  PlanLimits,
  SubscriptionStatus,
} from "./account-system/domain"
import { normalizePlanLimits } from "./account-plan-policy"
import { getSessionUser, type AuthUser } from "./auth"
import {
  applyFeatureFlagLimitsToPermissions,
  applyPlanLimitsToPermissions,
  applySubscriptionStatusToPermissions,
  basePermissionsForAccount,
  isPermissionCode,
} from "./permission-policy"
import { getPool, hasDatabaseUrl } from "./server-db"

export type AccountContextUser = AuthUser & {
  avatarUrl: string | null
  status: AccountStatus
}

export type AccountContext = {
  user: AccountContextUser
  account: {
    type: AccountType
    status: AccountStatus
    isSuperAdmin: boolean
    isEnterprise: boolean
    canManageTeam: boolean
    canUsePointMap: boolean
    subscriptionStatus: SubscriptionStatus | null
  }
  disabledFeatures: string[]
  permissions: PermissionCode[]
  organization: {
    id: string
    name: string
    role: string
  } | null
}

export type AccountContextUserRecord = {
  id: string
  email?: string | null
  phone?: string | null
  name?: string | null
  role?: string | null
  status?: string | null
  avatar_url?: string | null
}

type DbAccountContextRow = AccountContextUserRecord & {
  account_status?: AccountStatus | null
  account_type?: AccountType | null
  organization_id?: string | null
  organization_status?: string | null
  organization_name?: string | null
  organization_permissions?: PermissionCode[] | null
  disabled_features?: string[] | null
  organization_role?: string | null
  plan_code?: string | null
  plan_limits?: Partial<PlanLimits> | null
  subscription_status?: SubscriptionStatus | null
}

const superAdminRoles = new Set(["admin", "super_admin", "platform_admin"])
const enterpriseOwnerRoles = new Set(["owner", "enterprise_owner"])
const enterpriseMemberRoles = new Set(["manager", "editor", "finance", "viewer", "member_enterprise"])
const personalProRoles = new Set(["pro", "personal_pro", "sales", "designer", "project_manager", "engineer"])

export function buildAccountContext(
  sessionUser: AuthUser,
  record: AccountContextUserRecord | DbAccountContextRow = { id: sessionUser.userId, ...sessionUser },
  organization: AccountContext["organization"] = null
): AccountContext {
  const role = normalizeRole(record.role ?? sessionUser.role)
  const persistedAccountType = "account_type" in record ? record.account_type : null
  const accountType = persistedAccountType ?? deriveAccountTypeFromRole(role, organization)
  const userStatus = normalizeAccountStatus(record.status)
  const profileStatus = normalizeAccountStatus("account_status" in record ? record.account_status : null)
  const organizationStatus = "organization_status" in record ? record.organization_status : null
  const organizationDisabled = (accountType === "ENTERPRISE_OWNER" || accountType === "ENTERPRISE_MEMBER") &&
    organizationStatus && organizationStatus !== "active" && organizationStatus !== "expired"
  const accountStatus = userStatus !== "active" ? userStatus : organizationDisabled ? "disabled" : profileStatus
  const permissions = resolvePermissions(accountType, accountStatus, record)
  const disabledFeatures =
    "disabled_features" in record && record.disabled_features
      ? record.disabled_features
      : []

  return {
    account: {
      canManageTeam: permissions.includes("enterprise.manage_members"),
      canUsePointMap: permissions.includes("point_map.use"),
      isEnterprise: accountType === "ENTERPRISE_OWNER" || accountType === "ENTERPRISE_MEMBER",
      isSuperAdmin: accountType === "SUPER_ADMIN",
      subscriptionStatus: "subscription_status" in record ? (record.subscription_status ?? null) : null,
      status: accountStatus,
      type: accountType,
    },
    disabledFeatures,
    organization,
    permissions,
    user: {
      email: record.email ?? sessionUser.email ?? null,
      avatarUrl: record.avatar_url ?? null,
      name: record.name ?? sessionUser.name,
      phone: record.phone ?? sessionUser.phone ?? null,
      role,
      status: accountStatus,
      userId: record.id || sessionUser.userId,
    },
  }
}

export async function getCurrentAccountContext(): Promise<AccountContext | null> {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return null

  if (process.env.NODE_ENV === "development" && !hasDatabaseUrl() && sessionUser.userId === "local-admin") {
    return buildAccountContext(sessionUser)
  }

  const row = await loadAccountContextRow(sessionUser.userId)

  if (!row) {
    return null
  }

  return buildAccountContext(sessionUser, row, resolveOrganization(row))
}

export function deriveAccountTypeFromRole(
  role: string | null | undefined,
  organization: AccountContext["organization"] = null
): AccountType {
  const normalizedRole = normalizeRole(role)

  if (superAdminRoles.has(normalizedRole)) return "SUPER_ADMIN"
  if (enterpriseOwnerRoles.has(normalizedRole)) return "ENTERPRISE_OWNER"
  if (organization || enterpriseMemberRoles.has(normalizedRole)) return "ENTERPRISE_MEMBER"
  if (personalProRoles.has(normalizedRole)) return "PERSONAL_PRO"

  return "PERSONAL_FREE"
}

export function accountContextCan(context: AccountContext | null, permission: PermissionCode) {
  return Boolean(context?.permissions.includes(permission))
}

async function loadAccountContextRow(userId: string): Promise<DbAccountContextRow | null> {
  try {
    const result = await getPool().query<DbAccountContextRow>(
      `
      select
        u.id::text,
        u.email,
        u.phone,
        u.name,
        u.avatar_url,
        coalesce(u.role, 'member') as role,
        u.status::text as status,
        ap.account_type::text as account_type,
        ap.account_status::text as account_status,
        coalesce(org_plan.plan_code, p.plan_code) as plan_code,
        coalesce(org_plan.limits, p.limits) as plan_limits,
        case when o.status = 'expired' then 'expired' else coalesce(org_sub.status::text, s.status::text) end as subscription_status,
        o.id::text as organization_id,
        o.status::text as organization_status,
        o.name as organization_name,
        org_role.name as organization_role,
        (
          select coalesce(array_agg(orp.permission_code), array[]::text[])
          from organization_members om_perm
          join organization_role_permissions orp on orp.role_id = om_perm.role_id
          where om_perm.user_id = u.id
            and om_perm.organization_id = o.id
            and om_perm.member_status in ('active', 'invited')
        ) as organization_permissions,
        (
          select coalesce(array_agg(ff.key), array[]::text[])
          from feature_flags ff
          where ff.enabled = false
        ) as disabled_features
      from users u
      left join account_profiles ap on ap.user_id = u.id
      left join lateral (
        select * from subscriptions us
        where us.subject_type = 'user' and us.subject_id = u.id
          and us.status in ('free', 'active', 'grace_period', 'past_due', 'expired')
        order by case when us.status = 'expired' then 1 else 0 end, us.created_at desc, us.id desc
        limit 1
      ) s on true
      left join plans p on p.id = s.plan_id
      left join organization_members om on om.user_id = u.id
        and om.member_status in ('active', 'invited')
      left join organizations o on o.id = coalesce(ap.organization_id, om.organization_id)
      left join organization_roles org_role on org_role.id = om.role_id
      left join lateral (
        select * from subscriptions os
        where os.subject_type = 'organization' and os.subject_id = o.id
          and os.status in ('active', 'grace_period', 'past_due', 'expired')
        order by case when os.status = 'expired' then 1 else 0 end, os.created_at desc, os.id desc
        limit 1
      ) org_sub on true
      left join plans org_plan on org_plan.id = org_sub.plan_id
      where u.id = $1 and u.deleted_at is null
      limit 1
      `,
      [userId]
    )

    return result.rows[0] ?? null
  } catch {
    return null
  }
}

function resolveOrganization(row: DbAccountContextRow): AccountContext["organization"] {
  if (!row.organization_id || !row.organization_name) return null

  return {
    id: row.organization_id,
    name: row.organization_name,
    role: row.organization_role ?? row.role ?? "member",
  }
}

function normalizeRole(role: string | null | undefined) {
  return String(role || "member").trim().toLowerCase()
}

function normalizeAccountStatus(status: string | null | undefined): AccountStatus {
  if (!status) return "active"
  if (status === "active") return "active"
  if (status === "deleted") return "deleted"
  return "disabled"
}

function resolvePermissions(
  accountType: AccountType,
  accountStatus: AccountStatus,
  record: AccountContextUserRecord
): PermissionCode[] {
  if (accountStatus !== "active") return []

  const row = record as DbAccountContextRow
  const rolePermissions =
    accountType === "ENTERPRISE_MEMBER" && row.organization_permissions
      ? row.organization_permissions.filter(isPermissionCode)
      : null
  let permissions = new Set(rolePermissions ?? basePermissionsForAccount(accountType, accountStatus))
  const planCode = row.plan_code

  if (isKnownPlanCode(planCode) && row.plan_limits) {
    const limits = normalizePlanLimits(planCode, row.plan_limits)
    permissions = applyPlanLimitsToPermissions(permissions, limits)
  }
  permissions = applySubscriptionStatusToPermissions(permissions, row.subscription_status)

  permissions = applyFeatureFlagLimitsToPermissions(permissions, row.disabled_features ?? [])

  return Array.from(permissions)
}

function isKnownPlanCode(value: string | null | undefined): value is PlanCode {
  return [
    "FREE",
    "PERSONAL_PRO_MONTHLY",
    "PERSONAL_PRO_YEARLY",
    "ENTERPRISE_MONTHLY",
    "ENTERPRISE_YEARLY",
    "ENTERPRISE_CUSTOM",
  ].includes(String(value))
}
