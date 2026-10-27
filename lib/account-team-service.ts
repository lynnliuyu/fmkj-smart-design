import { randomUUID } from "crypto"
import bcrypt from "bcryptjs"

import { requireAccountPermission } from "./account-gates"
import type { AccountContext } from "./account-context"
import type { MemberStatus, PlanCode } from "./account-system/domain"
import type { PlatformPlan } from "./account-system/platform-admin-service"
import { normalizePlanLimits } from "./account-plan-policy"
import { getPool } from "./server-db"

type Queryable = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

type TransactionClient = Queryable & {
  release(): void
}

export type TeamRoleCode = "admin" | "editor" | "viewer" | "finance"

export type AccountTeamMember = {
  id: string
  userId: string
  name: string
  email: string
  roleCode: TeamRoleCode
  roleName: string
  status: MemberStatus
  projects: number
}

export type AccountTeam = {
  canManage: boolean
  memberLimit: number | null
  organization: {
    id: string
    name: string
    ownerUserId: string
  } | null
  members: AccountTeamMember[]
  plan: {
    code: PlanCode
    name: string
  } | null
  roles: Array<{ code: TeamRoleCode; id: string; name: string }>
}

export class AccountTeamError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code)
  }
}

const roleNames: Record<TeamRoleCode, string> = {
  admin: "经理-老板",
  editor: "销售",
  finance: "销售",
  viewer: "工程师",
}

const rolePermissions: Record<TeamRoleCode, string[]> = {
  admin: [
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
  editor: ["project.create", "project.edit", "project.view", "point_map.use", "export.advanced"],
  finance: ["project.create", "project.edit", "project.view", "export.advanced"],
  viewer: ["project.edit", "project.view", "point_map.use"],
}

export async function getAccountTeam(context: AccountContext): Promise<AccountTeam> {
  const gate = requireAccountPermission(context, "enterprise.manage_members")
  if (!gate.allowed) {
    return {
      canManage: false,
      memberLimit: null,
      members: [],
      organization: null,
      plan: null,
      roles: await listSystemRoles(getPool()),
    }
  }

  const organization = await ensureOrganizationForOwner(context)
  await ensureSystemRoles(getPool())
  const subscription = await ensureEnterpriseSubscription(organization.id)
  const plan = await getPlanById(getPool(), subscription.planId)
  const members = await listMembers(getPool(), organization.id)

  return {
    canManage: true,
    memberLimit: plan ? normalizePlanLimits(plan.planCode, plan.limits).maxMembers : null,
    members,
    organization,
    plan: plan ? { code: plan.planCode, name: plan.name } : null,
    roles: await listSystemRoles(getPool()),
  }
}

export async function createTeamMember(input: {
  context: AccountContext
  email: string
  name?: string
  password?: string
  roleCode: TeamRoleCode
}) {
  const organization = await requireManagedOrganization(input.context)
  const db = getPool()
  await ensureSystemRoles(db)
  await assertMemberLimit(db, organization.id)

  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes("@")) throw new AccountTeamError("VALID_EMAIL_REQUIRED")

  const role = await getRoleByCode(db, input.roleCode)
  if (!role) throw new AccountTeamError("ROLE_NOT_FOUND")

  const existing = await db.query<{ id: string }>(
    `
    select om.id::text as id
    from organization_members om
    join users u on u.id = om.user_id
    where om.organization_id = $1
      and lower(u.email) = $2
      and om.member_status <> 'removed'
    limit 1
    `,
    [organization.id, email],
  )

  if (existing.rows[0]) throw new AccountTeamError("MEMBER_ALREADY_EXISTS", 409)

  // Reject an existing account before opening the write transaction as a fast,
  // deterministic response; the transaction repeats this check for races.
  const globalExisting = await db.query<{ id: string }>(
    "select id::text from users where lower(email) = $1 limit 1",
    [email],
  )
  if (globalExisting.rows[0]) throw new AccountTeamError("USER_ALREADY_EXISTS", 409)

  // User creation, membership insertion and profile assignment must commit
  // together. An existing global email is rejected inside the same transaction;
  // it is never converted into an enterprise member or moved between companies.
  const client = (await db.connect()) as TransactionClient
  try {
    await client.query("begin")
    const globalExisting = await client.query<{ id: string }>(
      "select id::text from users where lower(email) = $1 limit 1",
      [email],
    )
    if (globalExisting.rows[0]) throw new AccountTeamError("USER_ALREADY_EXISTS", 409)

    const user = await upsertCreatedMemberUser(client, {
      email,
      name: input.name?.trim() || email.split("@")[0] || "新成员",
      password: input.password?.trim(),
    })

    await client.query(
      `
      insert into organization_members (organization_id, user_id, role_id, member_status)
      values ($1, $2, $3, 'active')
      on conflict (organization_id, user_id)
      do update set role_id = excluded.role_id, member_status = 'active', updated_at = now()
      `,
      [organization.id, user.id, role.id],
    )

    await client.query(
      `
      insert into account_profiles (user_id, account_type, account_status, organization_id)
      values ($1, 'ENTERPRISE_MEMBER', 'active', $2)
      on conflict (user_id)
      do update set account_type = 'ENTERPRISE_MEMBER', account_status = 'active', organization_id = excluded.organization_id, updated_at = now()
      `,
      [user.id, organization.id],
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    // A concurrent signup can win the unique email constraint after both
    // preflight checks. Keep the public contract as a clean 409 instead of
    // exposing a database error or partially applying team writes.
    if (isUniqueViolation(error)) throw new AccountTeamError("USER_ALREADY_EXISTS", 409)
    throw error
  } finally {
    client.release()
  }

  return getAccountTeam(input.context)
}

export async function updateTeamMember(input: {
  context: AccountContext
  memberId: string
  roleCode?: TeamRoleCode
  status?: Extract<MemberStatus, "active" | "disabled">
  transferToUserId?: string
}) {
  const organization = await requireManagedOrganization(input.context)
  const db = getPool()
  await ensureSystemRoles(db)

  const current = await db.query<{ id: string; userId: string }>(
    `
    select id::text, user_id::text as "userId"
    from organization_members
    where id = $1 and organization_id = $2 and member_status <> 'removed'
    limit 1
    `,
    [input.memberId, organization.id],
  )
  const member = current.rows[0]
  if (!member) throw new AccountTeamError("MEMBER_NOT_FOUND", 404)
  if (member.userId === organization.ownerUserId && input.status === "disabled") {
    throw new AccountTeamError("OWNER_CANNOT_BE_DISABLED")
  }

  const role = input.roleCode ? await getRoleByCode(db, input.roleCode) : null
  if (input.roleCode && !role) throw new AccountTeamError("ROLE_NOT_FOUND")

  if (input.status === "disabled") {
    if (!input.transferToUserId) throw new AccountTeamError("TRANSFER_TARGET_REQUIRED")
    if (input.transferToUserId === member.userId) throw new AccountTeamError("TRANSFER_TARGET_INVALID")

    const client = (await db.connect()) as TransactionClient
    try {
      await client.query("begin")
      await assertTransferTarget(client, {
        organizationId: organization.id,
        transferToUserId: input.transferToUserId,
      })
      await transferMemberProjects(client, {
        actorUserId: input.context.user.userId,
        fromUserId: member.userId,
        organizationId: organization.id,
        transferToUserId: input.transferToUserId,
      })
      await updateOrganizationMember(client, {
        memberId: input.memberId,
        organizationId: organization.id,
        roleId: role?.id ?? null,
        status: input.status,
      })
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  } else {
    await updateOrganizationMember(db, {
      memberId: input.memberId,
      organizationId: organization.id,
      roleId: role?.id ?? null,
      status: input.status ?? null,
    })
  }

  return getAccountTeam(input.context)
}

async function updateOrganizationMember(
  db: Queryable,
  input: {
    memberId: string
    organizationId: string
    roleId: string | null
    status: Extract<MemberStatus, "active" | "disabled"> | null
  },
) {
  await db.query(
    `
    update organization_members
    set role_id = coalesce($3::uuid, role_id),
        member_status = coalesce($4::member_status, member_status),
        updated_at = now()
    where id = $1 and organization_id = $2
    `,
    [input.memberId, input.organizationId, input.roleId, input.status],
  )
}

async function assertTransferTarget(
  db: Queryable,
  input: {
    organizationId: string
    transferToUserId: string
  },
) {
  const target = await db.query<{ id: string }>(
    `
    select id::text
    from organization_members
    where organization_id = $1
      and user_id = $2
      and member_status in ('active', 'invited')
    limit 1
    `,
    [input.organizationId, input.transferToUserId],
  )

  if (!target.rows[0]) throw new AccountTeamError("TRANSFER_TARGET_INVALID")
}

async function transferMemberProjects(
  db: Queryable,
  input: {
    actorUserId: string
    fromUserId: string
    organizationId: string
    transferToUserId: string
  },
) {
  const projects = await db.query<{ id: string; accessLevel: "admin" | "edit" | "view" | null }>(
    `
    select
      p.id::text as id,
      pm.access_level::text as "accessLevel"
    from projects p
    left join project_members pm on pm.project_id = p.id and pm.user_id = $1
    where coalesce(p.owner_type, 'user') = 'organization'
      and p.owner_id = $2
      and p.deleted_at is null
      and (
        p.created_by = $1
        or pm.status = 'active'
      )
    `,
    [input.fromUserId, input.organizationId],
  )

  await db.query(
    `
    update projects
    set created_by = $3,
        transferred_from_user_id = $2,
        updated_by = $4,
        updated_at = now()
    where coalesce(owner_type, 'user') = 'organization'
      and owner_id = $1
      and created_by = $2
      and deleted_at is null
    `,
    [input.organizationId, input.fromUserId, input.transferToUserId, input.actorUserId],
  )

  await db.query(
    `
    update project_members pm
    set status = 'disabled',
        updated_at = now()
    from projects p
    where pm.project_id = p.id
      and pm.user_id = $1
      and pm.status = 'active'
      and coalesce(p.owner_type, 'user') = 'organization'
      and p.owner_id = $2
      and p.deleted_at is null
    `,
    [input.fromUserId, input.organizationId],
  )

  for (const project of projects.rows) {
    await db.query(
      `
      insert into project_members (project_id, user_id, access_level, status)
      values ($1, $2, $3, 'active')
      on conflict (project_id, user_id)
      do update set access_level = excluded.access_level, status = 'active', updated_at = now()
      `,
      [project.id, input.transferToUserId, project.accessLevel ?? "edit"],
    )
  }
}

async function requireManagedOrganization(context: AccountContext) {
  const gate = requireAccountPermission(context, "enterprise.manage_members")
  if (!gate.allowed) throw new AccountTeamError(gate.reason, gate.reason === "NOT_AUTHENTICATED" ? 401 : 403)
  return ensureOrganizationForOwner(context)
}

async function ensureOrganizationForOwner(context: AccountContext) {
  const db = getPool()

  // A member with team-management permission must manage the organization
  // already attached to the current account context. Never create a second
  // organization or move the account profile just because the member opened
  // the team page.
  if (context.organization?.id) {
    const associated = await db.query<{ id: string; name: string; ownerUserId: string }>(
      `
      select id::text, name, owner_user_id::text as "ownerUserId"
      from organizations
      where id = $1 and status = 'active'
      limit 1
      `,
      [context.organization.id],
    )
    if (!associated.rows[0]) throw new AccountTeamError("ORGANIZATION_NOT_FOUND", 404)
    return associated.rows[0]
  }

  const existing = await db.query<{ id: string; name: string; ownerUserId: string }>(
    `
    select id::text, name, owner_user_id::text as "ownerUserId"
    from organizations
    where owner_user_id = $1 and status = 'active'
    limit 1
    `,
    [context.user.userId],
  )

  if (existing.rows[0]) return existing.rows[0]
  if (context.account.type !== "ENTERPRISE_OWNER" && context.account.type !== "SUPER_ADMIN") {
    throw new AccountTeamError("ORGANIZATION_REQUIRED", 403)
  }

  const created = await db.query<{ id: string; name: string; ownerUserId: string }>(
    `
    insert into organizations (name, owner_user_id, status)
    values ($1, $2, 'active')
    returning id::text, name, owner_user_id::text as "ownerUserId"
    `,
    [`${context.user.name || "企业"}团队`, context.user.userId],
  )

  await db.query(
    `
    update account_profiles
    set organization_id = $2, updated_at = now()
    where user_id = $1
    `,
    [context.user.userId, created.rows[0].id],
  )

  return created.rows[0]
}

async function ensureEnterpriseSubscription(organizationId: string) {
  const db = getPool()
  const current = await db.query<{ id: string; planId: string }>(
    `
    select id::text, plan_id::text as "planId"
    from subscriptions
    where subject_type = 'organization'
      and subject_id = $1
      and status in ('active', 'grace_period', 'past_due')
    limit 1
    `,
    [organizationId],
  )
  if (current.rows[0]) return current.rows[0]

  const plan = await getPlanByCode(db, "ENTERPRISE_MONTHLY")
  if (!plan) throw new AccountTeamError("ENTERPRISE_PLAN_NOT_FOUND", 500)

  const created = await db.query<{ id: string; planId: string }>(
    `
    insert into subscriptions (subject_type, subject_id, plan_id, status)
    values ('organization', $1, $2, 'active')
    returning id::text, plan_id::text as "planId"
    `,
    [organizationId, plan.id],
  )
  return created.rows[0]
}

async function assertMemberLimit(db: Queryable, organizationId: string) {
  const subscription = await ensureEnterpriseSubscription(organizationId)
  const plan = await getPlanById(db, subscription.planId)
  if (!plan) throw new AccountTeamError("PLAN_NOT_FOUND", 500)

  const limit = normalizePlanLimits(plan.planCode, plan.limits).maxMembers
  if (limit === null) return

  const count = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from organization_members
    where organization_id = $1 and member_status in ('active', 'invited')
    `,
    [organizationId],
  )

  if (Number(count.rows[0]?.count ?? 0) >= limit) {
    throw new AccountTeamError("MEMBER_LIMIT_REACHED", 403)
  }
}

async function ensureSystemRoles(db: Queryable) {
  for (const [code, name] of Object.entries(roleNames) as Array<[TeamRoleCode, string]>) {
    const role = await db.query<{ id: string }>(
      `
      insert into organization_roles (code, name, is_system)
      values ($1, $2, true)
      on conflict (code) where is_system = true do update set name = excluded.name
      returning id::text
      `,
      [code, name],
    )

    for (const permission of rolePermissions[code]) {
      await db.query(
        `
        insert into organization_role_permissions (role_id, permission_code)
        values ($1, $2)
        on conflict (role_id, permission_code) do nothing
        `,
        [role.rows[0].id, permission],
      )
    }
  }
}

async function listSystemRoles(db: Queryable) {
  await ensureSystemRoles(db)
  const result = await db.query<{ code: TeamRoleCode; id: string; name: string }>(
    `
    select id::text, code::text as code, name
    from organization_roles
    where code in ('admin', 'editor', 'viewer')
    order by case code when 'admin' then 1 when 'editor' then 2 when 'viewer' then 3 else 4 end
    `,
  )
  return result.rows
}

async function listMembers(db: Queryable, organizationId: string): Promise<AccountTeamMember[]> {
  const result = await db.query<AccountTeamMember>(
    `
    select
      om.id::text as id,
      u.id::text as "userId",
      coalesce(u.name, split_part(u.email, '@', 1), '') as name,
      coalesce(u.email, '') as email,
      r.code::text as "roleCode",
      r.name as "roleName",
      om.member_status::text as status,
      (
        select count(*)::int
        from projects p
        where p.created_by = u.id
          and p.deleted_at is null
          and p.status::text <> 'archived'
      ) as projects
    from organization_members om
    join users u on u.id = om.user_id
    join organization_roles r on r.id = om.role_id
    where om.organization_id = $1
      and om.member_status <> 'removed'
    order by case when om.member_status = 'active' then 1 when om.member_status = 'invited' then 2 else 3 end,
      u.name nulls last,
      u.email
    `,
    [organizationId],
  )

  return result.rows
}

async function getRoleByCode(db: Queryable, code: TeamRoleCode) {
  const result = await db.query<{ id: string; code: TeamRoleCode; name: string }>(
    "select id::text, code::text as code, name from organization_roles where code = $1 limit 1",
    [code],
  )
  return result.rows[0] ?? null
}

async function getPlanByCode(db: Queryable, planCode: PlanCode) {
  const result = await db.query<(PlatformPlan & { id: string })>(
    `
    select id::text, plan_code as "planCode", name, billing_cycle as "billingCycle", price_cents as "priceCents",
      currency, limits, is_active as "isActive", sort_order as "sortOrder"
    from plans
    where plan_code = $1 and is_active = true
    limit 1
    `,
    [planCode],
  )
  return result.rows[0] ?? null
}

async function getPlanById(db: Queryable, planId: string) {
  const result = await db.query<(PlatformPlan & { id: string })>(
    `
    select id::text, plan_code as "planCode", name, billing_cycle as "billingCycle", price_cents as "priceCents",
      currency, limits, is_active as "isActive", sort_order as "sortOrder"
    from plans
    where id = $1
    limit 1
    `,
    [planId],
  )
  return result.rows[0] ?? null
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "23505")
}

async function upsertCreatedMemberUser(db: Queryable, input: { email: string; name: string; password?: string }) {
  const existing = await db.query<{ id: string }>(
    "select id::text from users where lower(email) = $1 limit 1",
    [input.email],
  )
  if (existing.rows[0]) throw new AccountTeamError("USER_ALREADY_EXISTS", 409)

  const passwordHash = await bcrypt.hash(input.password || randomUUID(), 10)
  const roleId = await getDefaultUserRoleId(db)
  const created = await db.query<{ id: string }>(
    `
    insert into users (created_by, updated_by, status, name, email, password_hash, role_id, role)
    values ($1, $1, 'active', $2, $3, $4, $5::uuid, 'member')
    returning id::text
    `,
    ["10000000-0000-0000-0000-000000000002", input.name, input.email, passwordHash, roleId],
  )
  return created.rows[0]
}

async function getDefaultUserRoleId(db: Queryable) {
  const result = await db.query<{ id: string }>(
    `
    select id::text
    from roles
    where deleted_at is null
      and key in ('member', 'sales', 'owner')
    order by case key when 'member' then 1 when 'sales' then 2 else 3 end
    limit 1
    `,
  )
  return result.rows[0]?.id ?? null
}
