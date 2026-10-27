import type { AccountContext } from "./account-context"
import { projectVisibilityWhere, type ProjectMembershipAccess } from "./project-access"
import type {
  ProjectCreateRecordInput,
  ProjectRecord,
  ProjectWorkflowActivityAdapter,
  ProjectWorkflowRepository,
} from "./project-workflow"
import { ProjectWorkflow } from "./project-workflow"
import { getPool } from "./server-db"
import { tryRecordActivity, type RecordActivityInput } from "./server-activity-log"

const PROJECT_SELECT = `
  id::text,
  name,
  property_type as "propertyType",
  code,
  status::text as status,
  coalesce(customer_name, client_name, '') as customer,
  coalesce(phone, '') as phone,
  coalesce(community, '') as community,
  coalesce(building, '') as building,
  coalesce(room_no, '') as "roomNo",
  trim(concat_ws(' ', community, building, room_no)) as address,
  coalesce(platform, '') as platform,
  coalesce(owner, '') as owner,
  coalesce(designer, '') as designer,
  coalesce(budget, 0)::float8 as "budget",
  quote_amount::float8 as "quoteAmount",
  false as "hasQuote",
  false as "hasContract",
  false as "hasPointMap",
  false as "hasProductSelection",
  false as "hasAcceptedDelivery",
  stage::text as stage,
  case
    when risk_level in ('blocked', 'watch', 'normal') then risk_level
    when status_tone::text = 'error' then 'blocked'
    when status_tone::text = 'warn' then 'watch'
    else 'normal'
  end as risk,
  case
    when risk_level in ('blocked', 'watch', 'normal') then risk_level
    when status_tone::text = 'error' then 'blocked'
    when status_tone::text = 'warn' then 'watch'
    else 'normal'
  end as "riskLevel",
  coalesce(risk_reason, '') as "riskReason",
  coalesce(due_note, '') as "dueNote",
  coalesce(next_action, '') as "nextAction",
  next_action_due_at::text as "nextActionDueAt",
  next_action_owner_id::text as "nextActionOwnerId",
  coalesce(next_action_owner_name, owner, '') as "nextActionOwnerName",
  created_at::text as "createdAt",
  case
    when waiting_on in ('none', 'customer', 'internal', 'vendor') then waiting_on
    else 'none'
  end as "waitingOn",
  updated_at::text as "updatedAt",
  coalesce(to_jsonb(tags), '[]'::jsonb) as tags`

const PROJECT_STAGE_FACT_SELECT = `
  exists (
    select 1
    from quotes q
    where q.project_id = p.id
      and q.deleted_at is null
  ) as "hasQuote",
  exists (
    select 1
    from project_attachments pa
    where pa.project_id = p.id
      and pa.kind = 'contract'
      and pa.deleted_at is null
  ) as "hasContract",
  exists (
    select 1
    from project_attachments pa
    where pa.project_id = p.id
      and pa.kind = 'floorplan'
      and pa.deleted_at is null
  ) as "hasPointMap",
  false as "hasProductSelection",
  false as "hasAcceptedDelivery"`

export function createProjectWorkflow() {
  return new ProjectWorkflow({
    activity: new PostgresProjectActivityAdapter(),
    repository: new PostgresProjectWorkflowRepository(),
  })
}

export class PostgresProjectWorkflowRepository implements ProjectWorkflowRepository {
  async listVisibleProjects(context: AccountContext): Promise<ProjectRecord[]> {
    const visibility = projectVisibilityWhere(context)
    const result = await getPool().query<ProjectRecord>(
      `
      select
        ${PROJECT_SELECT},
        ${PROJECT_STAGE_FACT_SELECT}
      from projects p
      where deleted_at is null
        and status::text <> 'archived'
        and (${visibility.where})
      order by updated_at desc, created_at desc
      `,
      visibility.params
    )

    return result.rows
  }

  async countActivePersonalProjects(userId: string) {
    const result = await getPool().query<{ count: string }>(
      `
      select count(*)::text as count
      from projects
      where created_by = $1
        and deleted_at is null
        and status::text <> 'archived'
      `,
      [userId]
    )

    return Number(result.rows[0]?.count ?? 0)
  }

  async createProject(input: ProjectCreateRecordInput): Promise<ProjectRecord> {
    const result = await getPool().query<ProjectRecord>(
      `
      insert into projects (
        created_by, updated_by, status, name, code, client_name, customer_name, phone,
        community, building, room_no, budget, stage, stage_label, status_tone, progress, owner, designer,
        next_action, next_action_owner_name, waiting_on, risk_level, platform, tags, owner_type, owner_id, property_type
      )
      values ($1, $1, 'draft', $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, 'info', $12, $13, $14, $15, $16, 'none', 'normal', $17, $18::jsonb, $19, $20::uuid, $21)
      returning
        ${PROJECT_SELECT}
      `,
      [
        input.actorUserId,
        input.name,
        input.code,
        input.customer,
        input.phone,
        input.community,
        input.building,
        input.roomNo,
        input.budget,
        input.stage,
        input.stageLabel,
        input.progress,
        input.owner,
        input.designer,
        input.nextAction,
        input.nextActionOwnerName,
        input.platform,
        JSON.stringify(input.tags),
        input.ownerScope.ownerType,
        input.ownerScope.ownerId,
        input.propertyType,
      ]
    )

    return result.rows[0]
  }

  async grantProjectAccess(projectId: string, userId: string) {
    await getPool().query(
      `
      insert into project_members (project_id, user_id, access_level, status)
      values ($1, $2, 'admin', 'active')
      on conflict (project_id, user_id)
      do update set access_level = excluded.access_level, status = 'active', updated_at = now()
      `,
      [projectId, userId]
    )
  }

  async getProjectAccess(projectId: string, context: AccountContext) {
    const visibility = projectVisibilityWhere(context, 1)
    const actorParameter = `$${visibility.params.length + 2}`
    const result = await getPool().query<ProjectMembershipAccess>(
      `
      select p.created_by::text as "createdBy",
        (select pm.access_level::text from project_members pm
         where pm.project_id = p.id and pm.user_id = ${actorParameter}::uuid and pm.status = 'active'
         limit 1) as "accessLevel"
      from projects p
      where p.id = $1::uuid
        and p.deleted_at is null
        and (${visibility.where})
      limit 1
      `,
      [projectId, ...visibility.params, context.user.userId]
    )

    return result.rows[0] ?? null
  }

  async getProjectForStageUpdate(projectId: string) {
    const current = await getPool().query<{
      createdAt: Date
      name: string
      stage: ProjectRecord["stage"]
      stageLabel: string | null
    }>(
      `
      select
        created_at as "createdAt",
        name,
        stage::text as stage,
        stage_label as "stageLabel"
      from projects
      where id = $1 and deleted_at is null
      `,
      [projectId]
    )

    return current.rows[0] ?? null
  }

  async updateProjectStage(input: {
    actorUserId: string
    nextAction: string
    progress: number
    projectId: string
    stage: ProjectRecord["stage"]
    stageLabel: string
  }): Promise<ProjectRecord> {
    const result = await getPool().query<ProjectRecord>(
      `
      update projects
      set stage = $2,
          stage_label = $3,
          progress = $4,
          next_action = $5,
          next_action_owner_name = coalesce(next_action_owner_name, owner),
          risk_level = case when risk_level = 'blocked' then 'watch' else risk_level end,
          status_tone = case when status_tone::text = 'error' then 'warn'::project_status_tone else status_tone end,
          updated_by = $6,
          updated_at = now()
      where id = $1 and deleted_at is null
      returning
        ${PROJECT_SELECT}
      `,
      [input.projectId, input.stage, input.stageLabel, input.progress, input.nextAction, input.actorUserId]
    )

    return result.rows[0]
  }

  async updateProjectDetails(input: {
    actorUserId: string
    building: string
    community: string
    customer: string
    dueNote: string
    name: string
    nextAction: string
    nextActionDueAt: string | null
    nextActionOwnerName: string
    owner: string
    phone: string
    platform: string
    projectId: string
    roomNo: string
  }): Promise<ProjectRecord> {
    const result = await getPool().query<ProjectRecord>(
      `
      update projects
      set name = $2,
          client_name = $3,
          customer_name = $3,
          phone = $4,
          community = $5,
          building = $6,
          room_no = $7,
          owner = $8,
          platform = $9,
          next_action = $10,
          next_action_owner_name = $11,
          next_action_due_at = $12::timestamptz,
          due_note = $13,
          updated_by = $14,
          updated_at = now()
      where id = $1 and deleted_at is null
      returning
        ${PROJECT_SELECT}
      `,
      [
        input.projectId,
        input.name,
        input.customer,
        input.phone,
        input.community,
        input.building,
        input.roomNo,
        input.owner,
        input.platform,
        input.nextAction,
        input.nextActionOwnerName,
        input.nextActionDueAt,
        input.dueNote,
        input.actorUserId,
      ],
    )

    return result.rows[0]
  }

  async getProjectRisk(projectId: string) {
    const current = await getPool().query<{ name: string; risk: "normal" | "blocked" }>(
      `
      select
        name,
        case
          when risk_level in ('blocked', 'watch', 'normal') then risk_level
          when status_tone::text = 'error' then 'blocked'
          else 'normal'
        end as risk
      from projects
      where id = $1 and deleted_at is null
      `,
      [projectId]
    )

    return current.rows[0] ?? null
  }

  async updateProjectRisk(input: {
    actorUserId: string
    projectId: string
    risk: "normal" | "blocked"
    riskReason: string
    statusTone: "error" | "info"
  }): Promise<ProjectRecord> {
    const result = await getPool().query<ProjectRecord>(
      `
      update projects
      set status_tone = $2,
          risk_level = $4,
          risk_reason = case when $4 = 'blocked' then coalesce(nullif(risk_reason, ''), $5) else null end,
          updated_by = $3,
          updated_at = now()
      where id = $1 and deleted_at is null
      returning
        ${PROJECT_SELECT}
      `,
      [input.projectId, input.statusTone, input.actorUserId, input.risk, input.riskReason]
    )

    return result.rows[0]
  }
}

class PostgresProjectActivityAdapter implements ProjectWorkflowActivityAdapter {
  async record(input: RecordActivityInput) {
    await tryRecordActivity(getPool(), input)
  }
}
