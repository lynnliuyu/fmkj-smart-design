import type { AccountContext } from "./account-context"

export type ProjectOwnerScope =
  | { ownerType: "organization"; ownerId: string }
  | { ownerType: "user"; ownerId: string }

export type ProjectMembershipAccess = { createdBy: string; accessLevel: string | null }

/** A visible project can still have an explicit read-only assignment. */
export function canWriteProjectMembership(context: AccountContext, project: ProjectMembershipAccess) {
  if (context.account.type !== "ENTERPRISE_MEMBER") return true
  if (project.accessLevel === "view") return false
  return project.createdBy === context.user.userId || project.accessLevel === "admin" || project.accessLevel === "edit"
}

export function resolveProjectOwnerScope(context: AccountContext): ProjectOwnerScope {
  if (context.account.isEnterprise && context.organization) {
    return { ownerType: "organization", ownerId: context.organization.id }
  }

  return { ownerType: "user", ownerId: context.user.userId }
}

export function projectVisibilityWhere(context: AccountContext, offset = 0) {
  const param = (index: number) => `$${offset + index}`

  if (context.account.isSuperAdmin) {
    return { params: [] as string[], where: "true" }
  }

  if (context.account.type === "ENTERPRISE_OWNER" && context.organization) {
    return {
      params: [context.organization.id],
      where: `coalesce(p.owner_type, 'user') = 'organization' and p.owner_id = ${param(1)}::uuid`,
    }
  }

  if (context.account.type === "ENTERPRISE_MEMBER" && context.organization) {
    return {
      params: [context.organization.id, context.user.userId],
      where: `
        coalesce(p.owner_type, 'user') = 'organization'
        and p.owner_id = ${param(1)}::uuid
        and (
          p.created_by = ${param(2)}::uuid
          or exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = ${param(2)}::uuid
              and pm.status = 'active'
          )
        )
      `,
    }
  }

  return {
    params: [context.user.userId],
    where: `coalesce(p.owner_type, 'user') = 'user' and coalesce(p.owner_id, p.created_by) = ${param(1)}::uuid`,
  }
}
