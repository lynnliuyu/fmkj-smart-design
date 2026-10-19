import { getPool, hasDatabaseUrl } from "./server-db"

export type EnvironmentStatus = {
  groups: Array<{
    items: Array<{ key: string; present: boolean; required: boolean }>
    name: string
  }>
  ready: boolean
}

export type DatabaseStatus = {
  connected: boolean
  database: string | null
  errorCode: string | null
  tables: Array<{ count: number | null; name: string }>
  totalRows: number
  user: string | null
}

export type ServerStatus = {
  environmentReady: boolean
  nodeEnv: string
  now: string
  runtime: string
  version: string
}

export type AccessAnalytics = {
  activeActors7d: number
  actions24h: number
  actions7d: Array<{ count: number; day: string }>
  accountsByStatus: Array<{ count: number; status: string }>
  accountsByType: Array<{ count: number; type: string }>
  ordersByStatus: Array<{ count: number; status: string; totalCents: number }>
  organizationsByStatus: Array<{ count: number; status: string }>
  paidRevenueCents: number
  subscriptionsByStatus: Array<{ count: number; status: string }>
  topActions: Array<{ action: string; count: number }>
  topModules: Array<{ count: number; module: string }>
}

export type AuditLogEntry = {
  action: string
  actorId: string | null
  actorName: string | null
  description: string
  entityLabel: string
  entityType: string
  id: string
  occurredAt: string
  title: string
}

const environmentGroups = [
  {
    keys: [
      { key: "DATABASE_URL", required: true },
      { key: "DATABASE_SSL", required: false },
    ],
    name: "Database",
  },
  {
    keys: [
      { key: "AUTH_SECRET", required: true },
      { key: "DEV_AUTH_TOKEN", required: false },
    ],
    name: "Authentication",
  },
  {
    keys: [
      { key: "BLOB_READ_WRITE_TOKEN", required: false },
      { key: "FMKJ_API_BASE_URL", required: false },
    ],
    name: "Integrations",
  },
]

const operationalTables = [
  "users",
  "products",
  "projects",
  "quotes",
  "quote_items",
  "activity_logs",
  "account_profiles",
  "feature_flags",
  "orders",
  "organizations",
  "organization_members",
  "plans",
  "project_members",
  "subscriptions",
]

export function getEnvironmentStatus(): EnvironmentStatus {
  const groups = environmentGroups.map((group) => ({
    name: group.name,
    items: group.keys.map((item) => ({
      key: item.key,
      present: Boolean(process.env[item.key]),
      required: item.required,
    })),
  }))
  const ready = groups.every((group) => group.items.every((item) => !item.required || item.present))

  return { groups, ready }
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  if (!hasDatabaseUrl()) {
    return {
      connected: false,
      database: null,
      errorCode: "DATABASE_URL_MISSING",
      tables: operationalTables.map((name) => ({ count: null, name })),
      totalRows: 0,
      user: null,
    }
  }

  try {
    const [identity, tableRows] = await Promise.all([
      getPool().query<{ database: string; user: string }>("select current_database() as database, current_user as user"),
      Promise.all(
        operationalTables.map(async (name) => {
          try {
            const result = await getPool().query<{ count: number }>(
              `select count(*)::int as count from ${quoteIdentifier(name)}`
            )
            return { count: result.rows[0]?.count ?? 0, name }
          } catch {
            return { count: null, name }
          }
        })
      ),
    ])
    const totalRows = tableRows.reduce((sum, table) => sum + (table.count ?? 0), 0)

    return {
      connected: true,
      database: identity.rows[0]?.database ?? null,
      errorCode: null,
      tables: tableRows,
      totalRows,
      user: identity.rows[0]?.user ?? null,
    }
  } catch {
    return {
      connected: false,
      database: null,
      errorCode: "DATABASE_CONNECTION_FAILED",
      tables: operationalTables.map((name) => ({ count: null, name })),
      totalRows: 0,
      user: null,
    }
  }
}

export async function getServerStatus(): Promise<ServerStatus> {
  return {
    environmentReady: getEnvironmentStatus().ready,
    nodeEnv: process.env.NODE_ENV ?? "development",
    now: new Date().toISOString(),
    runtime: "nextjs",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  }
}

export async function getAccessAnalytics(): Promise<AccessAnalytics> {
  if (!hasDatabaseUrl()) {
    return emptyAnalytics()
  }

  try {
    const [
      actions24h,
      activeActors7d,
      actions7d,
      topActions,
      topModules,
      accountsByType,
      accountsByStatus,
      organizationsByStatus,
      subscriptionsByStatus,
      ordersByStatus,
      paidRevenue,
    ] = await Promise.all([
      getPool().query<{ count: number }>(
        "select count(*)::int as count from activity_logs where occurred_at >= now() - interval '24 hours'"
      ),
      getPool().query<{ count: number }>(
        "select count(distinct actor_id)::int as count from activity_logs where occurred_at >= now() - interval '7 days'"
      ),
      getPool().query<{ count: number; day: string }>(
        `
        select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day, count(*)::int as count
        from activity_logs
        where occurred_at >= now() - interval '7 days'
        group by 1
        order by 1
        `
      ),
      getPool().query<{ action: string; count: number }>(
        `
        select action, count(*)::int as count
        from activity_logs
        where occurred_at >= now() - interval '7 days'
        group by action
        order by count desc, action asc
        limit 8
        `
      ),
      getPool().query<{ count: number; module: string }>(
        `
        select entity_type as module, count(*)::int as count
        from activity_logs
        where occurred_at >= now() - interval '7 days'
        group by entity_type
        order by count desc, entity_type asc
        limit 8
        `
      ),
      getPool().query<{ count: number; type: string }>(
        `
        select account_type::text as type, count(*)::int as count
        from account_profiles
        group by account_type
        order by count desc, account_type asc
        `
      ),
      getPool().query<{ count: number; status: string }>(
        `
        select account_status::text as status, count(*)::int as count
        from account_profiles
        group by account_status
        order by count desc, account_status asc
        `
      ),
      getPool().query<{ count: number; status: string }>(
        `
        select status::text, count(*)::int as count
        from organizations
        group by status
        order by count desc, status asc
        `
      ),
      getPool().query<{ count: number; status: string }>(
        `
        select status::text, count(*)::int as count
        from subscriptions
        group by status
        order by count desc, status asc
        `
      ),
      getPool().query<{ count: number; status: string; total_cents: number }>(
        `
        select status::text, count(*)::int as count, coalesce(sum(amount_cents), 0)::int as total_cents
        from orders
        group by status
        order by count desc, status asc
        `
      ),
      getPool().query<{ total_cents: number }>(
        "select coalesce(sum(amount_cents), 0)::int as total_cents from orders where status = 'paid'"
      ),
    ])

    return {
      activeActors7d: activeActors7d.rows[0]?.count ?? 0,
      actions24h: actions24h.rows[0]?.count ?? 0,
      actions7d: actions7d.rows,
      accountsByStatus: accountsByStatus.rows,
      accountsByType: accountsByType.rows,
      ordersByStatus: ordersByStatus.rows.map((row) => ({
        count: row.count,
        status: row.status,
        totalCents: Number(row.total_cents ?? 0),
      })),
      organizationsByStatus: organizationsByStatus.rows,
      paidRevenueCents: Number(paidRevenue.rows[0]?.total_cents ?? 0),
      subscriptionsByStatus: subscriptionsByStatus.rows,
      topActions: topActions.rows,
      topModules: topModules.rows,
    }
  } catch {
    return emptyAnalytics()
  }
}

export async function listAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
  if (!hasDatabaseUrl()) return []

  const result = await getPool().query<{
    action: string
    actor_id: string | null
    actor_name: string | null
    description: string
    entity_label: string
    entity_type: string
    id: string
    occurred_at: Date | string
    title: string
  }>(
    `
    select id::text, actor_id::text, actor_name, entity_type, entity_label,
      action, title, description, occurred_at
    from activity_logs
    order by occurred_at desc, created_at desc
    limit $1
    `,
    [Math.min(Math.max(limit, 1), 200)]
  )

  return result.rows.map((row) => ({
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    description: row.description,
    entityLabel: row.entity_label,
    entityType: row.entity_type,
    id: row.id,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    title: row.title,
  }))
}

function emptyAnalytics(): AccessAnalytics {
  return {
    activeActors7d: 0,
    actions24h: 0,
    actions7d: [],
    accountsByStatus: [],
    accountsByType: [],
    ordersByStatus: [],
    organizationsByStatus: [],
    paidRevenueCents: 0,
    subscriptionsByStatus: [],
    topActions: [],
    topModules: [],
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}
