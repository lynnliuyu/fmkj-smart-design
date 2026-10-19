import type { Pool, PoolClient } from "pg";

export type ActivityAction =
  | "project.created"
  | "project.updated"
  | "project.stage_advanced"
  | "project.risk_toggled"
  | "quote.created"
  | "quote.updated"
  | "work_order.created"
  | "work_order.completed";

export type ActivityEntityType = "project" | "quote" | "work_order";

export type RecordActivityInput = {
  action: ActivityAction;
  actorId?: string | null;
  actorName?: string | null;
  description: string;
  durationSeconds?: number | null;
  entityId?: string | null;
  entityLabel: string;
  entityType: ActivityEntityType;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  tenantId?: string | null;
  title: string;
};

type ActivityQueryable = Pick<Pool | PoolClient, "query">;

export async function recordActivity(
  db: ActivityQueryable,
  input: RecordActivityInput,
) {
  const result = await db.query<{ id: string }>(
    `
    insert into activity_logs (
      tenant_id, actor_id, actor_name, entity_type, entity_id, entity_label,
      action, title, description, occurred_at, duration_seconds, metadata
    )
    values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12::jsonb)
    returning id::text
    `,
    [
      input.tenantId ?? null,
      input.actorId ?? null,
      input.actorName ?? null,
      input.entityType,
      input.entityId ?? null,
      input.entityLabel,
      input.action,
      input.title,
      input.description,
      input.occurredAt ?? new Date(),
      input.durationSeconds ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return result.rows[0]?.id ?? null;
}

export async function tryRecordActivity(
  db: ActivityQueryable,
  input: RecordActivityInput,
) {
  try {
    return await recordActivity(db, input);
  } catch {
    return null;
  }
}

export function secondsBetween(start: Date | string, end: Date | string) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);

  return Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 1000),
  );
}
