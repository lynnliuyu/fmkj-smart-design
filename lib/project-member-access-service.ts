import type { AccountContext } from "./account-context"
import { requireAccountPermission } from "./account-gates"
import { projectVisibilityWhere } from "./project-access"
import { getPool } from "./server-db"

type Queryable = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

export type ProjectMemberAccess = {
  accessLevel: "admin" | "edit" | "view"
  email: string
  granted: boolean
  memberId: string
  name: string
  roleName: string
  status: "active" | "disabled" | "invited" | "removed"
  userId: string
}

export type ProjectAccessPayload = {
  canManage: boolean
  members: ProjectMemberAccess[]
  projectId: string
}

export class ProjectAccessError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code)
  }
}

export async function getProjectAccessList(context: AccountContext, projectId: string): Promise<ProjectAccessPayload> {
  const project = await requireVisibleProject(context, projectId)
  const organizationId = project.ownerId

  if (project.ownerType !== "organization" || !organizationId) {
    return { canManage: false, members: [], projectId }
  }

  const canManage = canManageProjectAccess(context, organizationId)
  const members = await listOrganizationProjectMembers(getPool(), organizationId, projectId)

  return { canManage, members, projectId }
}

export async function setProjectMemberAccess(input: {
  accessLevel?: "edit" | "view"
  context: AccountContext
  granted: boolean
  projectId: string
  userId: string
}): Promise<ProjectAccessPayload> {
  const edit = requireAccountPermission(input.context, "project.edit")
  if (!edit.allowed) throw new ProjectAccessError(edit.reason, 403)
  const project = await requireVisibleProject(input.context, input.projectId)

  if (project.ownerType !== "organization" || !project.ownerId) {
    throw new ProjectAccessError("PROJECT_NOT_ENTERPRISE", 400)
  }

  if (!canManageProjectAccess(input.context, project.ownerId)) {
    throw new ProjectAccessError("ROLE_PERMISSION_DENIED", 403)
  }

  const member = await getActiveOrganizationMember(getPool(), project.ownerId, input.userId)
  if (!member) throw new ProjectAccessError("MEMBER_NOT_FOUND", 404)

  if (input.granted) {
    await getPool().query(
      `
      insert into project_members (project_id, user_id, access_level, status)
      values ($1, $2, $3, 'active')
      on conflict (project_id, user_id)
      do update set access_level = excluded.access_level, status = 'active', updated_at = now()
      `,
      [input.projectId, input.userId, input.accessLevel ?? "edit"],
    )
  } else {
    if (input.userId === project.createdBy) {
      throw new ProjectAccessError("CREATOR_ACCESS_REQUIRED", 400)
    }

    await getPool().query(
      `
      update project_members
      set status = 'disabled', updated_at = now()
      where project_id = $1 and user_id = $2
      `,
      [input.projectId, input.userId],
    )
  }

  return getProjectAccessList(input.context, input.projectId)
}

async function requireVisibleProject(context: AccountContext, projectId: string) {
  if (context.account.status !== "active") throw new ProjectAccessError("ACCOUNT_DISABLED", 403)
  if (!context.permissions.includes("project.view")) throw new ProjectAccessError("ROLE_PERMISSION_DENIED", 403)
  const visibility = projectVisibilityWhere(context, 1)
  const result = await getPool().query<{
    createdBy: string
    id: string
    ownerId: string | null
    ownerType: "organization" | "user"
  }>(
    `
    select
      p.id::text as id,
      coalesce(p.owner_type, 'user')::text as "ownerType",
      p.owner_id::text as "ownerId",
      p.created_by::text as "createdBy"
    from projects p
    where p.id = $1::uuid
      and p.deleted_at is null
      and (${visibility.where})
    limit 1
    `,
    [projectId, ...visibility.params],
  )

  const project = result.rows[0]
  if (!project) throw new ProjectAccessError("RESOURCE_NOT_FOUND_OR_NOT_OWNED", 404)
  return project
}

function canManageProjectAccess(context: AccountContext, organizationId: string) {
  if (!requireAccountPermission(context, "project.edit").allowed) return false
  return (
    context.account.isSuperAdmin ||
    (context.account.type === "ENTERPRISE_OWNER" && context.organization?.id === organizationId) ||
    context.permissions.includes("enterprise.manage_members")
  )
}

async function getActiveOrganizationMember(db: Queryable, organizationId: string, userId: string) {
  const result = await db.query<{ id: string }>(
    `
    select id::text
    from organization_members
    where organization_id = $1
      and user_id = $2
      and member_status in ('active', 'invited')
    limit 1
    `,
    [organizationId, userId],
  )

  return result.rows[0] ?? null
}

async function listOrganizationProjectMembers(db: Queryable, organizationId: string, projectId: string) {
  const result = await db.query<ProjectMemberAccess>(
    `
    select
      om.id::text as "memberId",
      u.id::text as "userId",
      coalesce(u.name, split_part(u.email, '@', 1), '') as name,
      coalesce(u.email, '') as email,
      r.name as "roleName",
      om.member_status::text as status,
      coalesce(pm.access_level, 'edit')::text as "accessLevel",
      (pm.status = 'active') as granted
    from organization_members om
    join users u on u.id = om.user_id
    join organization_roles r on r.id = om.role_id
    left join project_members pm on pm.project_id = $2 and pm.user_id = u.id
    where om.organization_id = $1
      and om.member_status <> 'removed'
    order by granted desc, case when om.member_status = 'active' then 1 when om.member_status = 'invited' then 2 else 3 end, u.name, u.email
    `,
    [organizationId, projectId],
  )

  return result.rows
}
