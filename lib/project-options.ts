import type { AccountContext } from "./account-context"
import { getPool } from "./server-db"

export type ProjectOption = {
  label: string
  value: string
}

export type ProjectCommunityOption = ProjectOption & {
  projectCount: number
}

export type ProjectOptionsPayload = {
  communities: ProjectCommunityOption[]
  owners: ProjectOption[]
  platforms: ProjectOption[]
}

const defaultPlatforms = ["米家", "Aqara Home", "Apple Home", "华为鸿蒙智家", "KNX", "Control4", "网络/弱电", "待定"]
const defaultOwners = ["经理-老板", "销售", "工程师", "运营负责人", "待分配"]

export async function listProjectOptions(context: AccountContext): Promise<ProjectOptionsPayload> {
  const [communities, owners, platforms] = await Promise.all([
    listCommunities(),
    listOwners(context),
    listPlatforms(),
  ])

  return {
    communities,
    owners,
    platforms,
  }
}

export async function rememberProjectCommunity(name: string) {
  const community = name.trim()
  if (!community) return

  try {
    await getPool().query(
      `
      insert into project_communities (name, status, project_count, last_used_at)
      values ($1, 'active', 1, now())
      on conflict (lower(name)) where deleted_at is null
      do update set
        project_count = project_communities.project_count + 1,
        last_used_at = now(),
        status = 'active',
        updated_at = now()
      `,
      [community],
    )
  } catch {
    // Project creation should not fail just because the optional community catalog is unavailable.
  }
}

async function listCommunities(): Promise<ProjectCommunityOption[]> {
  try {
    const result = await getPool().query<{ name: string; projectCount: number }>(
      `
      select name, project_count as "projectCount"
      from project_communities
      where deleted_at is null and status = 'active'
      order by last_used_at desc nulls last, project_count desc, name asc
      limit 80
      `,
    )

    return result.rows.map((row) => ({
      label: row.name,
      projectCount: Number(row.projectCount ?? 0),
      value: row.name,
    }))
  } catch {
    return []
  }
}

async function listOwners(context: AccountContext): Promise<ProjectOption[]> {
  const ownerNames = new Set<string>()
  addOption(ownerNames, context.user.name)
  addOption(ownerNames, context.user.email)

  if (context.organization?.id) {
    try {
      const result = await getPool().query<{ name: string | null; email: string | null }>(
        `
        select u.name, u.email
        from organization_members om
        join users u on u.id = om.user_id
        where om.organization_id = $1::uuid
          and om.member_status in ('active', 'invited')
        order by
          case when u.id = $2::uuid then 0 else 1 end,
          u.name nulls last,
          u.email
        limit 80
        `,
        [context.organization.id, context.user.userId],
      )

      for (const row of result.rows) {
        addOption(ownerNames, row.name || row.email)
      }
    } catch {
      // Fall through to default owner choices.
    }
  }

  for (const owner of defaultOwners) addOption(ownerNames, owner)
  return Array.from(ownerNames).map(toOption)
}

async function listPlatforms(): Promise<ProjectOption[]> {
  const platforms = new Set<string>()

  try {
    const result = await getPool().query<{ platform: string }>(
      `
      select platform
      from (
        select distinct nullif(trim(platform), '') as platform
        from products
        where deleted_at is null
        union
        select distinct nullif(trim(platform), '') as platform
        from projects
        where deleted_at is null
      ) options
      where platform is not null
      order by platform asc
      limit 80
      `,
    )

    for (const row of result.rows) addOption(platforms, row.platform)
  } catch {
    // Fall through to defaults.
  }

  for (const platform of defaultPlatforms) addOption(platforms, platform)
  return Array.from(platforms).map(toOption)
}

function addOption(options: Set<string>, value: string | null | undefined) {
  const normalized = value?.trim()
  if (normalized) options.add(normalized)
}

function toOption(value: string): ProjectOption {
  return { label: value, value }
}
