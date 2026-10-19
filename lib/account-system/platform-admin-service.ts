import bcrypt from "bcryptjs"
import type { Pool, PoolClient } from "pg"

import { getPool } from "../server-db"
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
} from "../account-plan-policy"

import type {
  AccountStatus,
  AccountType,
  BillingCycle,
  OrderStatus,
  PlanCode,
  PlanLimits,
  SubscriptionStatus,
  SubjectType,
} from "./domain"

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"
export { defaultPlanLimits, isEnterprisePlanCode, normalizePlanLimits }

export type PlatformPlan = {
  billingCycle: BillingCycle
  currency: "CNY"
  id: string
  isActive: boolean
  limits: PlanLimits
  name: string
  planCode: PlanCode
  priceCents: number
  sortOrder: number
  updatedAt: string
}

export type PlatformCustomer = {
  accountStatus: AccountStatus
  accountType: AccountType
  createdAt: string | null
  email: string | null
  id: string
  lastLoginAt: string | null
  name: string
  organizationId: string | null
  organizationName: string | null
  organizationOwnerUserId: string | null
  phone: string | null
  planCode: PlanCode | null
  planName: string | null
  subscriptionId: string | null
  subscriptionStatus: SubscriptionStatus | null
}

export type PlatformCustomerDetail = PlatformCustomer & {
  activities: Array<{
    action: string
    description: string
    occurredAt: string
    title: string
  }>
}

export type PlatformOrganization = {
  id: string
  memberCount: number
  name: string
  ownerEmail: string | null
  ownerName: string | null
  ownerUserId: string
  planCode: PlanCode | null
  planName: string | null
  status: string
  subscriptionId: string | null
  subscriptionStatus: SubscriptionStatus | null
}

export type PlatformOrder = {
  amountCents: number
  createdAt: string
  currency: string
  id: string
  paidAt: string | null
  planCode: PlanCode | null
  planName: string | null
  status: OrderStatus
  subjectId: string
  subjectLabel: string
  subjectType: SubjectType
}

export type PlatformFeatureFlag = {
  description: string | null
  enabled: boolean
  key: string
  updatedAt: string
  updatedByUserId: string | null
}

type Queryable = Pick<Pool | PoolClient, "query">

type PlanRow = {
  billing_cycle: BillingCycle
  currency: "CNY"
  id: string
  is_active: boolean
  limits: Partial<PlanLimits>
  name: string
  plan_code: PlanCode
  price_cents: number
  sort_order: number
  updated_at: Date | string
}

type CustomerRow = {
  account_status: AccountStatus | null
  account_type: AccountType | null
  created_at: Date | string | null
  email: string | null
  id: string
  last_login_at: Date | string | null
  organization_id: string | null
  organization_name: string | null
  organization_owner_user_id: string | null
  name: string | null
  phone: string | null
  plan_code: PlanCode | null
  plan_name: string | null
  subscription_id: string | null
  subscription_status: SubscriptionStatus | null
}

type OrganizationRow = {
  id: string
  member_count: string | number
  name: string
  owner_email: string | null
  owner_name: string | null
  owner_user_id: string
  plan_code: PlanCode | null
  plan_name: string | null
  status: string
  subscription_id: string | null
  subscription_status: SubscriptionStatus | null
}

type OrderRow = {
  amount_cents: number
  created_at: Date | string
  currency: string
  id: string
  paid_at: Date | string | null
  plan_code: PlanCode | null
  plan_name: string | null
  status: OrderStatus
  subject_id: string
  subject_label: string | null
  subject_type: SubjectType
}

type FeatureFlagRow = {
  description: string | null
  enabled: boolean
  key: string
  updated_at: Date | string
  updated_by_user_id: string | null
}

export class PlatformValidationError extends Error {
  details: Record<string, string>

  constructor(details: Record<string, string>) {
    super("VALIDATION_ERROR")
    this.name = "PlatformValidationError"
    this.details = details
  }
}

export function platformValidationErrorResponse(error: unknown) {
  if (error instanceof PlatformValidationError) {
    return Response.json(
      { code: "VALIDATION_ERROR", details: error.details, error: "VALIDATION_ERROR" },
      { status: 400 }
    )
  }

  throw error
}

export async function listPlatformCustomers(): Promise<PlatformCustomer[]> {
  const result = await getPool().query<CustomerRow>(customerSelectSql("order by u.created_at desc"))
  return result.rows.map(mapCustomer)
}

export async function listPlatformOrganizations(): Promise<PlatformOrganization[]> {
  const result = await getPool().query<OrganizationRow>(
    `
    select
      o.id::text,
      o.name,
      o.owner_user_id::text,
      o.status::text,
      owner.name as owner_name,
      owner.email as owner_email,
      s.id::text as subscription_id,
      s.status::text as subscription_status,
      p.plan_code,
      p.name as plan_name,
      (
        select count(*)::text
        from organization_members om
        where om.organization_id = o.id
          and om.member_status in ('active', 'invited')
      ) as member_count
    from organizations o
    join users owner on owner.id = o.owner_user_id
    left join subscriptions s on s.subject_type = 'organization'
      and s.subject_id = o.id
      and s.status in ('active', 'grace_period', 'past_due', 'expired')
    left join plans p on p.id = s.plan_id
    order by o.updated_at desc, o.created_at desc
    `
  )

  return result.rows.map(mapOrganization)
}

export async function listPlatformOrders(): Promise<PlatformOrder[]> {
  const result = await getPool().query<OrderRow>(
    `
    select
      o.id::text,
      o.subject_type::text,
      o.subject_id::text,
      coalesce(u.name, u.email, org.name, o.subject_id::text) as subject_label,
      p.plan_code,
      p.name as plan_name,
      o.amount_cents,
      o.currency,
      o.status::text,
      o.paid_at,
      o.created_at
    from orders o
    left join plans p on p.id = o.plan_id
    left join users u on o.subject_type = 'user' and u.id = o.subject_id
    left join organizations org on o.subject_type = 'organization' and org.id = o.subject_id
    order by o.created_at desc
    limit 200
    `
  )

  return result.rows.map(mapOrder)
}

export async function listPlatformFeatureFlags(): Promise<PlatformFeatureFlag[]> {
  await ensureDefaultFeatureFlags(getPool())
  const result = await getPool().query<FeatureFlagRow>(
    `
    select key, enabled, description, updated_by_user_id::text, updated_at
    from feature_flags
    order by key
    `
  )

  return result.rows.map(mapFeatureFlag)
}

export async function getPlatformCustomer(id: string): Promise<PlatformCustomerDetail | null> {
  const result = await getPool().query<CustomerRow>(customerSelectSql("where u.id = $1::uuid limit 1"), [id])
  const customer = result.rows[0] ? mapCustomer(result.rows[0]) : null
  if (!customer) return null

  const activities = await getPool().query<{
    action: string
    description: string
    occurred_at: Date | string
    title: string
  }>(
    `
    select action, title, description, occurred_at
    from activity_logs
    where entity_type = 'account'
      and entity_id = $1::uuid
    order by occurred_at desc
    limit 12
    `,
    [id]
  )

  return {
    ...customer,
    activities: activities.rows.map((row) => ({
      action: row.action,
      description: row.description,
      occurredAt: toIsoString(row.occurred_at),
      title: row.title,
    })),
  }
}

export async function createPlatformCustomer(input: {
  accountType: AccountType
  actorUserId: string
  email: string
  name: string
  password?: string
  phone?: string
  planCode: PlanCode
}) {
  validateCustomerInput(input)

  const client = await getPool().connect()

  try {
    await client.query("begin")
    const existing = await client.query<{ id: string }>(
      `
      select id::text
      from users
      where lower(email) = $1
      limit 1
      `,
      [input.email.trim().toLowerCase()]
    )

    if (existing.rows[0]) {
      throw new PlatformValidationError({ email: "Email already exists" })
    }

    const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null
    const user = await client.query<{ id: string }>(
      `
      insert into users (name, email, phone, password_hash, role, status)
      values ($1, $2, $3, $4, $5, 'active')
      returning id::text
      `,
      [
        input.name.trim(),
        input.email.trim().toLowerCase(),
        normalizeOptional(input.phone),
        passwordHash,
        roleForAccountType(input.accountType),
      ]
    )

    await upsertAccountProfile(client, user.rows[0].id, input.accountType, "active")
    await assignSubscription(client, {
      actorUserId: input.actorUserId,
      planCode: input.planCode,
      subjectId: user.rows[0].id,
      subjectType: "user",
    })
    await recordPlatformActivity(client, {
      action: "account.created",
      actorUserId: input.actorUserId,
      description: `Created customer ${input.name.trim()} as ${input.accountType}`,
      entityId: user.rows[0].id,
      entityLabel: input.name.trim(),
      title: "Customer created",
    })

    await client.query("commit")
    return getPlatformCustomer(user.rows[0].id)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function updatePlatformCustomer(input: {
  accountStatus: AccountStatus
  accountType: AccountType
  actorUserId: string
  userId: string
}) {
  validateAccountUpdate(input)

  const client = await getPool().connect()

  try {
    await client.query("begin")
    await upsertAccountProfile(client, input.userId, input.accountType, input.accountStatus)
    await client.query(
      `
      update users
      set role = $2,
          status = case when $3 = 'active' then 'active' else 'inactive' end,
          updated_at = now()
      where id = $1::uuid
      `,
      [input.userId, roleForAccountType(input.accountType), input.accountStatus]
    )
    await recordPlatformActivity(client, {
      action: "account.updated",
      actorUserId: input.actorUserId,
      description: `Updated account type to ${input.accountType} and status to ${input.accountStatus}`,
      entityId: input.userId,
      entityLabel: input.userId,
      title: "Customer account updated",
    })
    await client.query("commit")
    return getPlatformCustomer(input.userId)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function assignPlatformCustomerPlan(input: {
  actorUserId: string
  planCode: PlanCode
  status?: SubscriptionStatus
  userId: string
}) {
  validatePlanCode(input.planCode)
  if (input.status) validateSubscriptionStatus(input.status)

  const client = await getPool().connect()

  try {
    await client.query("begin")
    await assignSubscription(client, {
      actorUserId: input.actorUserId,
      planCode: input.planCode,
      status: input.status,
      subjectId: input.userId,
      subjectType: "user",
    })
    await applyAccountTypeForPlan(client, input.userId, input.planCode)
    await recordPlatformActivity(client, {
      action: "subscription.assigned",
      actorUserId: input.actorUserId,
      description: `分配套餐 ${localizedPlanName(null, input.planCode)}`,
      entityId: input.userId,
      entityLabel: input.userId,
      title: "客户套餐已分配",
    })
    await client.query("commit")
    return getPlatformCustomer(input.userId)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function assignPlatformOrganizationPlan(input: {
  actorUserId: string
  organizationId: string
  planCode: PlanCode
  status?: SubscriptionStatus
}) {
  validatePlanCode(input.planCode)
  if (!isEnterprisePlanCode(input.planCode)) {
    throw new PlatformValidationError({ planCode: "企业只能分配企业套餐" })
  }
  if (input.status) validateSubscriptionStatus(input.status)

  const organization = await getPool().query<{ id: string; name: string }>(
    "select id::text, name from organizations where id = $1::uuid limit 1",
    [input.organizationId]
  )

  if (!organization.rows[0]) {
    throw new PlatformValidationError({ organizationId: "企业不存在" })
  }

  const client = await getPool().connect()

  try {
    await client.query("begin")
    await assignSubscription(client, {
      actorUserId: input.actorUserId,
      planCode: input.planCode,
      status: input.status,
      subjectId: input.organizationId,
      subjectType: "organization",
    })
    await client.query(
      `
      update organizations
      set status = case when $2::subscription_status = 'expired' then 'expired'::organization_status else 'active'::organization_status end,
          updated_at = now()
      where id = $1::uuid
      `,
      [input.organizationId, input.status ?? "active"]
    )
    await recordPlatformActivity(client, {
      action: "organization.subscription.assigned",
      actorUserId: input.actorUserId,
      description: `Assigned organization plan ${input.planCode}`,
      entityId: input.organizationId,
      entityLabel: organization.rows[0].name,
      title: "Organization subscription assigned",
    })
    await client.query("commit")
    return getPlatformOrganization(input.organizationId)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function updatePlatformFeatureFlag(input: {
  actorUserId: string
  description?: string
  enabled: boolean
  key: string
}) {
  const key = input.key.trim()
  if (!key) throw new PlatformValidationError({ key: "Feature key is required" })

  const client = await getPool().connect()

  try {
    await client.query("begin")
    const result = await client.query<FeatureFlagRow>(
      `
      insert into feature_flags (key, enabled, description, updated_by_user_id, updated_at)
      values ($1, $2, $3, $4::uuid, now())
      on conflict (key) do update
      set enabled = excluded.enabled,
          description = excluded.description,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      returning key, enabled, description, updated_by_user_id::text, updated_at
      `,
      [key, input.enabled, input.description?.trim() || null, input.actorUserId]
    )
    await recordPlatformActivity(client, {
      action: "feature_flag.update",
      actorUserId: input.actorUserId,
      description: `Feature flag ${key} set to ${input.enabled ? "enabled" : "disabled"}`,
      entityId: input.actorUserId,
      entityLabel: key,
      entityType: "feature_flag",
      title: "Feature flag updated",
    })
    await client.query("commit")
    return mapFeatureFlag(result.rows[0])
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function getPlatformOrganization(id: string): Promise<PlatformOrganization | null> {
  const result = await getPool().query<OrganizationRow>(
    `
    select
      o.id::text,
      o.name,
      o.owner_user_id::text,
      o.status::text,
      owner.name as owner_name,
      owner.email as owner_email,
      s.id::text as subscription_id,
      s.status::text as subscription_status,
      p.plan_code,
      p.name as plan_name,
      (
        select count(*)::text
        from organization_members om
        where om.organization_id = o.id
          and om.member_status in ('active', 'invited')
      ) as member_count
    from organizations o
    join users owner on owner.id = o.owner_user_id
    left join subscriptions s on s.subject_type = 'organization'
      and s.subject_id = o.id
      and s.status in ('active', 'grace_period', 'past_due', 'expired')
    left join plans p on p.id = s.plan_id
    where o.id = $1::uuid
    limit 1
    `,
    [id]
  )

  return result.rows[0] ? mapOrganization(result.rows[0]) : null
}

export async function listPlatformPlans(): Promise<PlatformPlan[]> {
  const result = await getPool().query<PlanRow>(
    `
    select id::text, plan_code, name, billing_cycle, price_cents, currency, limits,
      is_active, sort_order, updated_at
    from plans
    order by sort_order, plan_code
    `
  )
  return result.rows.map(mapPlan)
}

export async function updatePlatformPlan(input: {
  actorUserId: string
  isActive: boolean
  limits: PlanLimits
  name: string
  planId: string
  priceCents: number
}) {
  validatePlanUpdate(input)

  const client = await getPool().connect()

  try {
    await client.query("begin")
    const result = await client.query<PlanRow>(
      `
      update plans
      set name = $2,
          price_cents = $3,
          limits = $4::jsonb,
          is_active = $5,
          updated_at = now()
      where id = $1::uuid
      returning id::text, plan_code, name, billing_cycle, price_cents, currency, limits,
        is_active, sort_order, updated_at
      `,
      [
        input.planId,
        input.name.trim(),
        input.priceCents,
        JSON.stringify(input.limits),
        input.isActive,
      ]
    )

    const plan = result.rows[0]
    if (!plan) {
      throw new PlatformValidationError({ planId: "套餐不存在" })
    }

    await recordPlatformActivity(client, {
      action: "plan.updated",
      actorUserId: input.actorUserId,
      description: `更新套餐 ${plan.name}`,
      entityId: plan.id,
      entityLabel: plan.name,
      title: "套餐已更新",
    })
    await client.query("commit")
    return mapPlan(plan)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

function customerSelectSql(suffix: string) {
  return `
    select
      u.id::text,
      u.email,
      u.phone,
      u.name,
      u.created_at,
      u.last_login_at,
      coalesce(ap.account_type::text, 'PERSONAL_FREE') as account_type,
      coalesce(ap.account_status::text, case when u.status::text = 'active' then 'active' else 'disabled' end) as account_status,
      org.id::text as organization_id,
      org.name as organization_name,
      org.owner_user_id::text as organization_owner_user_id,
      s.id::text as subscription_id,
      s.status::text as subscription_status,
      p.plan_code,
      p.name as plan_name
    from users u
    left join account_profiles ap on ap.user_id = u.id
    left join organization_members om on om.user_id = u.id and om.member_status in ('active', 'invited')
    left join organizations org on org.id = coalesce(ap.organization_id, om.organization_id)
    left join subscriptions s on s.subject_type = 'user'
      and s.subject_id = u.id
      and s.status in ('free', 'active', 'grace_period', 'past_due')
    left join plans p on p.id = s.plan_id
    ${suffix}
  `
}

async function assignSubscription(
  db: Queryable,
  input: {
    actorUserId: string
    planCode: PlanCode
    status?: SubscriptionStatus
    subjectId: string
    subjectType: SubjectType
  }
) {
  const plan = await db.query<{ id: string; billing_cycle: BillingCycle }>(
    `
    select id::text, billing_cycle
    from plans
    where plan_code = $1
      and is_active = true
    limit 1
    `,
    [input.planCode]
  )

  if (!plan.rows[0]) {
    throw new PlatformValidationError({ planCode: "套餐不存在或已停用" })
  }

  await db.query(
    `
    update subscriptions
    set status = 'canceled',
        canceled_at = coalesce(canceled_at, now()),
        updated_at = now()
    where subject_type = $1
      and subject_id = $2::uuid
      and status in ('free', 'active', 'grace_period', 'past_due')
    `,
    [input.subjectType, input.subjectId]
  )

  const status = input.status ?? defaultSubscriptionStatusForPlan(input.planCode)
  const endsAtSql = plan.rows[0].billing_cycle === "yearly" ? "now() + interval '1 year'" : "null"

  await db.query(
    `
    insert into subscriptions (subject_type, subject_id, plan_id, status, starts_at, ends_at)
    values ($1, $2::uuid, $3::uuid, $4, now(), ${endsAtSql})
    `,
    [input.subjectType, input.subjectId, plan.rows[0].id, status]
  )
}

async function applyAccountTypeForPlan(db: Queryable, userId: string, planCode: PlanCode) {
  const accountType = accountTypeForPlan(planCode)
  await upsertAccountProfile(db, userId, accountType, "active")
  await db.query(`update users set role = $2, updated_at = now() where id = $1::uuid`, [
    userId,
    roleForAccountType(accountType),
  ])
}

async function upsertAccountProfile(
  db: Queryable,
  userId: string,
  accountType: AccountType,
  accountStatus: AccountStatus
) {
  await db.query(
    `
    insert into account_profiles (user_id, account_type, account_status)
    values ($1::uuid, $2, $3)
    on conflict (user_id) do update
    set account_type = excluded.account_type,
        account_status = excluded.account_status,
        updated_at = now()
    `,
    [userId, accountType, accountStatus]
  )
}

async function recordPlatformActivity(
  db: Queryable,
  input: {
    action: string
    actorUserId: string
    description: string
    entityId: string
    entityLabel: string
    entityType?: "account" | "feature_flag" | "organization" | "plan"
    title: string
  }
) {
  const entityType =
    input.entityType ??
    (input.action.startsWith("plan.")
      ? "plan"
      : input.action.startsWith("organization.")
        ? "organization"
        : "account")

  await db.query(
    `
    insert into activity_logs (
      actor_id, entity_type, entity_id, entity_label, action, title, description, metadata
    )
    values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      input.actorUserId || SYSTEM_USER_ID,
      entityType,
      input.entityId,
      input.entityLabel,
      input.action,
      input.title,
      input.description,
      JSON.stringify({ source: "platform-admin" }),
    ]
  )
}

function mapCustomer(row: CustomerRow): PlatformCustomer {
  return {
    accountStatus: row.account_status ?? "active",
    accountType: row.account_type ?? "PERSONAL_FREE",
    createdAt: row.created_at ? toIsoString(row.created_at) : null,
    email: row.email,
    id: row.id,
    lastLoginAt: row.last_login_at ? toIsoString(row.last_login_at) : null,
    name: row.name ?? row.email ?? "未命名客户",
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationOwnerUserId: row.organization_owner_user_id,
    phone: row.phone,
    planCode: row.plan_code,
    planName: localizedPlanName(row.plan_name, row.plan_code),
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
  }
}

function mapOrganization(row: OrganizationRow): PlatformOrganization {
  return {
    id: row.id,
    memberCount: Number(row.member_count ?? 0),
    name: row.name,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    ownerUserId: row.owner_user_id,
    planCode: row.plan_code,
    planName: localizedPlanName(row.plan_name, row.plan_code),
    status: row.status,
    subscriptionId: row.subscription_id,
    subscriptionStatus: row.subscription_status,
  }
}

function mapOrder(row: OrderRow): PlatformOrder {
  return {
    amountCents: Number(row.amount_cents ?? 0),
    createdAt: toIsoString(row.created_at),
    currency: row.currency,
    id: row.id,
    paidAt: row.paid_at ? toIsoString(row.paid_at) : null,
    planCode: row.plan_code,
    planName: localizedPlanName(row.plan_name, row.plan_code),
    status: row.status,
    subjectId: row.subject_id,
    subjectLabel: row.subject_label ?? row.subject_id,
    subjectType: row.subject_type,
  }
}

function mapFeatureFlag(row: FeatureFlagRow): PlatformFeatureFlag {
  return {
    description: row.description,
    enabled: row.enabled,
    key: row.key,
    updatedAt: toIsoString(row.updated_at),
    updatedByUserId: row.updated_by_user_id,
  }
}

async function ensureDefaultFeatureFlags(db: Queryable) {
  const defaults: PlatformFeatureFlag[] = [
    {
      description: "控制点位图入口和编辑能力",
      enabled: true,
      key: "point_map",
      updatedAt: new Date().toISOString(),
      updatedByUserId: null,
    },
    {
      description: "控制高级导出入口",
      enabled: true,
      key: "advanced_export",
      updatedAt: new Date().toISOString(),
      updatedByUserId: null,
    },
    {
      description: "控制企业团队协作入口",
      enabled: true,
      key: "enterprise_team",
      updatedAt: new Date().toISOString(),
      updatedByUserId: null,
    },
  ]

  for (const flag of defaults) {
    await db.query(
      `
      insert into feature_flags (key, enabled, description)
      values ($1, $2, $3)
      on conflict (key) do nothing
      `,
      [flag.key, flag.enabled, flag.description]
    )
  }
}

function mapPlan(row: PlanRow): PlatformPlan {
  return {
    billingCycle: row.billing_cycle,
    currency: row.currency,
    id: row.id,
    isActive: row.is_active,
    limits: normalizePlanLimits(row.plan_code, row.limits),
    name: localizedPlanName(row.name, row.plan_code),
    planCode: row.plan_code,
    priceCents: row.price_cents,
    sortOrder: row.sort_order,
    updatedAt: toIsoString(row.updated_at),
  }
}

function localizedPlanName(name: string | null | undefined, planCode: PlanCode | null | undefined) {
  const normalizedName = String(name ?? "").trim()
  const normalizedKey = normalizedName.toLowerCase().replace(/[\s_-]+/g, "")
  const labels: Record<string, string> = {
    enterprisecustom: "企业定制版",
    enterprisemonthly: "企业版（月付）",
    enterpriseyearly: "企业版（年付）",
    free: "个人免费版",
    personalpromonthly: "个人升级版（月付）",
    personalproyearly: "个人升级版（年付）",
  }
  const codeLabels: Record<PlanCode, string> = {
    ENTERPRISE_CUSTOM: "企业定制版",
    ENTERPRISE_MONTHLY: "企业版（月付）",
    ENTERPRISE_YEARLY: "企业版（年付）",
    FREE: "个人免费版",
    PERSONAL_PRO_MONTHLY: "个人升级版（月付）",
    PERSONAL_PRO_YEARLY: "个人升级版（年付）",
  }

  return labels[normalizedKey] ?? (planCode ? codeLabels[planCode] : undefined) ?? normalizedName
}

function validateCustomerInput(input: {
  accountType: AccountType
  email: string
  name: string
  password?: string
  planCode: PlanCode
}) {
  const details: Record<string, string> = {}
  if (!input.name.trim()) details.name = "请填写客户名称"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) details.email = "请填写有效邮箱"
  if (input.password && input.password.length < 8) details.password = "密码至少需要 8 位"
  if (!isAccountType(input.accountType)) details.accountType = "账号类型无效"
  if (!isPlanCode(input.planCode)) details.planCode = "套餐无效"
  if (Object.keys(details).length > 0) throw new PlatformValidationError(details)
}

function validateAccountUpdate(input: {
  accountStatus: AccountStatus
  accountType: AccountType
  userId: string
}) {
  const details: Record<string, string> = {}
  if (!input.userId) details.userId = "客户不存在"
  if (!isAccountType(input.accountType)) details.accountType = "账号类型无效"
  if (!["active", "disabled", "deleted"].includes(input.accountStatus)) {
    details.accountStatus = "账号状态无效"
  }
  if (Object.keys(details).length > 0) throw new PlatformValidationError(details)
}

function validatePlanUpdate(input: {
  limits: PlanLimits
  name: string
  planId: string
  priceCents: number
}) {
  const details = validatePlanUpdateFields(input)
  if (Object.keys(details).length > 0) throw new PlatformValidationError(details)
}

function validatePlanCode(planCode: PlanCode) {
  if (!isPlanCode(planCode)) {
    throw new PlatformValidationError({ planCode: "套餐无效" })
  }
}

function validateSubscriptionStatus(status: SubscriptionStatus) {
  if (!isSubscriptionStatus(status)) {
    throw new PlatformValidationError({ status: "订阅状态无效" })
  }
}

function isAccountType(value: string): value is AccountType {
  return [
    "SUPER_ADMIN",
    "ENTERPRISE_OWNER",
    "ENTERPRISE_MEMBER",
    "PERSONAL_PRO",
    "PERSONAL_FREE",
  ].includes(value)
}

function normalizeOptional(value?: string) {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
