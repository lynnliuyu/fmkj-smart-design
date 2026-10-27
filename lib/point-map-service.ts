import type { Pool, PoolClient } from "pg"

import type { AccountContext } from "./account-context"
import { requireAccountPermission } from "./account-gates"
import { validateDesignPlan } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"
import { canWriteProjectMembership, projectVisibilityWhere } from "./project-access"
import { getPool } from "./server-db"
import { hydratePlanSelections } from "./point-map-selection-service"

export const MAX_POINT_MAP_REQUEST_BYTES = 32 * 1024 * 1024
export const MAX_POINT_MAP_REVISION = 2_147_483_647

export type PointMapPayload = {
  data: PointMapPlan | null
  revision: number
}

export type SaveProjectPointMapInput = {
  plan: PointMapPlan
  expectedRevision: number
}

type Dependencies = { db?: Pick<Pool, "connect">; now?: () => Date }
type Client = Pick<PoolClient, "query" | "release">
type VisibleProject = { createdBy: string; accessLevel: string | null }

export class PointMapServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
    public readonly revision?: number,
  ) {
    super(message)
    this.name = "PointMapServiceError"
  }
}

export async function getProjectPointMap(
  context: AccountContext | null,
  projectId: string,
  dependencies: Dependencies = {},
): Promise<PointMapPayload> {
  const account = requireContext(context, projectId)
  const client = await (dependencies.db ?? getPool()).connect()
  try {
    await client.query("begin isolation level repeatable read read only")
    await requireVisibleProject(client, account, projectId)
    assertPermission(account, "point_map.use")

    const result = await readPointMap(client, projectId)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function saveProjectPointMap(
  context: AccountContext | null,
  projectId: string,
  input: unknown,
  dependencies: Dependencies = {},
): Promise<PointMapPayload> {
  const account = requireContext(context, projectId)
  const client = await (dependencies.db ?? getPool()).connect()
  try {
    await client.query("begin")
    // Lock the project even when no draft exists, serializing concurrent first saves.
    const project = await requireVisibleProject(client, account, projectId, true)
    assertPermission(account, "point_map.use")
    assertPermission(account, "project.edit")
    assertWritableMembership(account, project)
    const parsed = validateSaveInput(input, projectId)

    const existing = await client.query<{ revision: number; plan: PointMapPlan }>(
      `select revision, plan from project_point_map_designs where project_id = $1::uuid for update`,
      [projectId],
    )
    const currentRevision = existing.rows[0]?.revision ?? 0
    if (parsed.expectedRevision !== currentRevision) {
      throw new PointMapServiceError("POINT_MAP_REVISION_CONFLICT", 409, "POINT_MAP_REVISION_CONFLICT", currentRevision)
    }
    if (currentRevision === MAX_POINT_MAP_REVISION) {
      throw new PointMapServiceError("POINT_MAP_REVISION_LIMIT", 409)
    }

    const revision = currentRevision + 1
    const plan = await hydratePlanSelections(client, {
      ...parsed.plan, updatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    }, account.user.userId, existing.rows[0]?.plan)
    const serialized = JSON.stringify(plan)
    // Legacy normalization adds an active-floor mirror. Enforce the limit after
    // normalization as well so a saved plan can be reloaded and saved again.
    if (Buffer.byteLength(JSON.stringify({ plan, expectedRevision: revision }), "utf8") > MAX_POINT_MAP_REQUEST_BYTES) {
      throw new PointMapServiceError("POINT_MAP_TOO_LARGE", 413)
    }
    if (existing.rows[0]) {
      const saved = await client.query<{ revision: number }>(
        `update project_point_map_designs
         set plan = $2::jsonb, revision = $3, updated_by = $4::uuid, updated_at = now()
         where project_id = $1::uuid and revision = $5
         returning revision`,
        [projectId, serialized, revision, account.user.userId, currentRevision],
      )
      if (!saved.rows[0]) throw new PointMapServiceError("POINT_MAP_REVISION_CONFLICT", 409)
    } else {
      await client.query(
        `insert into project_point_map_designs (project_id, plan, revision, updated_by)
         values ($1::uuid, $2::jsonb, $3, $4::uuid)`,
        [projectId, serialized, revision, account.user.userId],
      )
    }

    await client.query("commit")
    return { data: plan, revision }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export function requireContext(context: AccountContext | null, projectId: string): AccountContext {
  if (!context) throw new PointMapServiceError("NOT_AUTHENTICATED", 401)
  if (context.account.status !== "active") throw new PointMapServiceError("ACCOUNT_DISABLED", 403)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new PointMapServiceError("RESOURCE_NOT_FOUND_OR_NOT_OWNED", 404)
  }
  return context
}

export async function requireVisibleProject(client: Client, context: AccountContext, projectId: string, lock = false) {
  const visibility = projectVisibilityWhere(context, 1)
  const actorParameter = `$${visibility.params.length + 2}`
  const result = await client.query<VisibleProject>(
    `select p.created_by::text as "createdBy",
       (select pm.access_level::text from project_members pm
        where pm.project_id = p.id and pm.user_id = ${actorParameter}::uuid and pm.status = 'active'
        limit 1) as "accessLevel"
     from projects p
     where p.id = $1::uuid and p.deleted_at is null and (${visibility.where})
     ${lock ? "for update of p" : ""}`,
    [projectId, ...visibility.params, context.user.userId],
  )
  const project = result.rows[0]
  if (!project) throw new PointMapServiceError("RESOURCE_NOT_FOUND_OR_NOT_OWNED", 404)
  return project
}

export function assertPermission(context: AccountContext, permission: "point_map.use" | "project.edit") {
  const gate = requireAccountPermission(context, permission)
  if (!gate.allowed) throw new PointMapServiceError(gate.reason, gate.reason === "NOT_AUTHENTICATED" ? 401 : 403)
}

export function assertWritableMembership(context: AccountContext, project: VisibleProject) {
  if (!canWriteProjectMembership(context, project)) {
    throw new PointMapServiceError("PROJECT_READ_ONLY", 403)
  }
}

function validateSaveInput(value: unknown, projectId: string): SaveProjectPointMapInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
  }
  const input = value as Record<string, unknown>
  if (!isRevision(input.expectedRevision, true)) {
    throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
  }
  try {
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_POINT_MAP_REQUEST_BYTES) {
      throw new PointMapServiceError("POINT_MAP_TOO_LARGE", 413)
    }
    return {
      expectedRevision: input.expectedRevision as number,
      plan: validateDesignPlan(input.plan, projectId),
    }
  } catch (error) {
    if (error instanceof PointMapServiceError) throw error
    throw new PointMapServiceError("VALIDATION_ERROR", 400, error instanceof Error ? error.message : "点位方案数据无效")
  }
}

function isRevision(value: unknown, allowZero: boolean): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_POINT_MAP_REVISION
}

/** 只读草稿：确认版本功能已下线（草图 + 固定交付版本才是现行工作流）。 */
async function readPointMap(client: Client, projectId: string): Promise<PointMapPayload> {
  const result = await client.query<{ plan: PointMapPlan; revision: number }>(
    `select plan, revision from project_point_map_designs where project_id = $1::uuid`, [projectId],
  )
  const row = result.rows[0]
  return { data: row?.plan ?? null, revision: row?.revision ?? 0 }
}
