export type AccountType =
  | "SUPER_ADMIN"
  | "ENTERPRISE_OWNER"
  | "ENTERPRISE_MEMBER"
  | "PERSONAL_PRO"
  | "PERSONAL_FREE";

export type AccountStatus = "active" | "disabled" | "deleted";

export type PlanCode =
  | "FREE"
  | "PERSONAL_PRO_MONTHLY"
  | "PERSONAL_PRO_YEARLY"
  | "ENTERPRISE_MONTHLY"
  | "ENTERPRISE_YEARLY"
  | "ENTERPRISE_CUSTOM";

export type SubscriptionStatus =
  | "free"
  | "active"
  | "grace_period"
  | "past_due"
  | "expired"
  | "canceled";

export type OrganizationStatus = "active" | "disabled" | "expired" | "deleted";
export type MemberStatus = "invited" | "active" | "disabled" | "removed";
export type ProjectStatus = "active" | "archived" | "deleted";
export type OwnerType = "user" | "organization";
export type SubjectType = "user" | "organization";

export type PermissionCode =
  | "account.manage_all"
  | "platform.manage_features"
  | "enterprise.manage_members"
  | "enterprise.manage_roles"
  | "enterprise.manage_billing"
  | "project.create"
  | "project.edit"
  | "project.view"
  | "project.delete"
  | "point_map.use"
  | "export.advanced"
  | "order.view";

export type DenialReason =
  | "NOT_AUTHENTICATED"
  | "ACCOUNT_DISABLED"
  | "PLAN_REQUIRED"
  | "PROJECT_LIMIT_REACHED"
  | "POINT_MAP_NOT_INCLUDED"
  | "TEAM_FEATURE_REQUIRED"
  | "ROLE_PERMISSION_DENIED"
  | "RESOURCE_NOT_FOUND_OR_NOT_OWNED"
  | "SUBSCRIPTION_EXPIRED"
  | "PLATFORM_ADMIN_REQUIRED";

export type BillingCycle = "free" | "monthly" | "yearly" | "custom";
export type OrderStatus = "pending" | "paid" | "failed" | "refunded" | "canceled";
export type AuditAction =
  | "account.update"
  | "account.disable"
  | "account.restore"
  | "plan.update"
  | "feature_flag.update";

export interface User {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
}

export interface AccountProfile {
  userId: string;
  accountType: AccountType;
  accountStatus: AccountStatus;
}

export interface PlanLimits {
  maxProjects: number | null;
  maxMembers: number | null;
  canUsePointMap: boolean;
  canCreateTeam: boolean;
  canCreateSubAccounts: boolean;
  canUseAdvancedExport: boolean;
  storageLimitMb: number | null;
  supportLevel: "standard" | "priority" | "enterprise" | "dedicated";
}

export interface Plan {
  id: string;
  planCode: PlanCode;
  name: string;
  billingCycle: BillingCycle;
  priceCents: number;
  currency: "CNY";
  limits: PlanLimits;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  planId: string;
  status: SubscriptionStatus;
  startsAt?: Date;
  endsAt?: Date;
  canceledAt?: Date;
  graceEndsAt?: Date;
}

export interface Order {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  planId: string;
  amountCents: number;
  currency: "CNY";
  status: OrderStatus;
  paidAt?: Date;
  createdAt: Date;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  updatedByUserId?: string;
  updatedAt?: Date;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: AuditAction;
  targetType: "account" | "plan" | "feature_flag";
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  ownerUserId: string;
  status: OrganizationStatus;
}

export interface Role {
  id: string;
  organizationId?: string;
  code: "admin" | "editor" | "viewer" | "finance";
  name: string;
  isSystem: boolean;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  roleId: string;
  memberStatus: MemberStatus;
}

export interface RolePermission {
  roleId: string;
  permissionCode: PermissionCode;
}

export interface Project {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  status: ProjectStatus;
  createdByUserId: string;
  transferredFromUserId?: string;
}

export interface AuthzResource {
  ownerType?: OwnerType;
  ownerId?: string;
  organizationId?: string;
  projectId?: string;
}

export interface AllowResult {
  allowed: true;
}

export interface DenyResult {
  allowed: false;
  reason: DenialReason;
}

export type PermissionResult = AllowResult | DenyResult;
