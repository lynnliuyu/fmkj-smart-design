import type { Pool, PoolClient } from "pg"

import { getPool, hasDatabaseUrl } from "./server-db"

export const platformSettingDefinitions = [
  {
    description: "后台和客户访问时展示的主站域名；DNS 和反向代理仍需在部署平台配置。",
    key: "APP_PRIMARY_DOMAIN",
    label: "主域名",
    placeholder: "https://www.example.com",
    type: "url",
  },
  {
    description: "图片、附件、导出文件等资源访问域名；对象存储或 CDN 绑定仍需在对应平台配置。",
    key: "APP_ASSET_DOMAIN",
    label: "资源域名",
    placeholder: "https://assets.example.com",
    type: "url",
  },
  {
    description: "系统通知、客户沟通、工单回访中默认展示的支持邮箱。",
    key: "SUPPORT_EMAIL",
    label: "支持邮箱",
    placeholder: "support@example.com",
    type: "email",
  },
  {
    description: "记录当前部署环境的用途、负责人或切换说明；不会改写服务器环境变量。",
    key: "ENVIRONMENT_NOTE",
    label: "环境说明",
    placeholder: "例如：生产环境，由运营团队维护",
    type: "textarea",
  },
  {
    description: "记录数据库连接的管理备注；真实连接串请继续在服务器或部署平台的环境变量中维护。",
    key: "DATABASE_CONNECTION_NOTE",
    label: "数据库连接备注",
    placeholder: "例如：Neon 生产库，修改前先备份",
    type: "textarea",
  },
] as const

export type PlatformSettingKey = (typeof platformSettingDefinitions)[number]["key"]

export type PlatformSetting = {
  description: string
  key: PlatformSettingKey
  label: string
  placeholder: string
  type: "email" | "textarea" | "url"
  updatedAt: string | null
  value: string
}

type Queryable = Pick<Pool | PoolClient, "query">

type PlatformSettingRow = {
  key: PlatformSettingKey
  updated_at: Date | string | null
  value: string | null
}

export async function listPlatformSettings(): Promise<PlatformSetting[]> {
  if (!hasDatabaseUrl()) {
    return platformSettingDefinitions.map((definition) => ({
      ...definition,
      updatedAt: null,
      value: "",
    }))
  }

  const db = getPool()
  await ensurePlatformSettingsTable(db)
  const result = await db.query<PlatformSettingRow>(
    `
      select key, value, updated_at
      from platform_settings
      where key = any($1::text[])
    `,
    [platformSettingDefinitions.map((definition) => definition.key)]
  )
  const rows = new Map(result.rows.map((row) => [row.key, row]))

  return platformSettingDefinitions.map((definition) => {
    const row = rows.get(definition.key)
    return {
      ...definition,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      value: row?.value ?? "",
    }
  })
}

export async function updatePlatformSettings({
  actorUserId,
  values,
}: {
  actorUserId: string
  values: Partial<Record<PlatformSettingKey, string>>
}) {
  if (!hasDatabaseUrl()) {
    throw new PlatformSettingsError("DATABASE_REQUIRED")
  }

  const db = getPool()
  await ensurePlatformSettingsTable(db)

  const allowedKeys = new Set(platformSettingDefinitions.map((definition) => definition.key))
  const entries = Object.entries(values)
    .filter((entry): entry is [PlatformSettingKey, string] => allowedKeys.has(entry[0] as PlatformSettingKey))
    .map(([key, value]) => [key, value.trim()] as const)

  if (entries.length === 0) {
    throw new PlatformSettingsError("EMPTY_SETTINGS")
  }

  for (const [key, value] of entries) {
    validateSettingValue(key, value)
    await db.query(
      `
        insert into platform_settings (key, value, updated_by_user_id, updated_at)
        values ($1, $2, $3, now())
        on conflict (key)
        do update set
          value = excluded.value,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [key, value, actorUserId]
    )
  }

  return listPlatformSettings()
}

export type PlatformSettingsErrorCode = "DATABASE_REQUIRED" | "EMPTY_SETTINGS" | "INVALID_EMAIL" | "INVALID_URL"

export class PlatformSettingsError extends Error {
  code: PlatformSettingsErrorCode
  status: 400 | 503

  constructor(code: PlatformSettingsErrorCode) {
    super(code)
    this.name = "PlatformSettingsError"
    this.code = code
    this.status = code === "DATABASE_REQUIRED" ? 503 : 400
  }
}

export function platformSettingsErrorResponse(error: unknown) {
  if (error instanceof PlatformSettingsError) {
    const messages: Record<PlatformSettingsErrorCode, string> = {
      DATABASE_REQUIRED: "数据库未连接，暂时不能保存系统配置",
      EMPTY_SETTINGS: "没有可保存的配置项",
      INVALID_EMAIL: "请输入有效的邮箱地址",
      INVALID_URL: "请输入以 http:// 或 https:// 开头的域名",
    }

    return Response.json({ error: messages[error.code] }, { status: error.status })
  }

  throw error
}

async function ensurePlatformSettingsTable(db: Queryable) {
  await db.query(`
    create table if not exists platform_settings (
      key text primary key,
      value text not null default '',
      updated_by_user_id uuid references users(id),
      updated_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    )
  `)

  await db.query(`
    create index if not exists platform_settings_updated_idx
      on platform_settings (updated_at desc)
  `)
}

function validateSettingValue(key: PlatformSettingKey, value: string) {
  if (!value) return

  const definition = platformSettingDefinitions.find((item) => item.key === key)

  if (definition?.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new PlatformSettingsError("INVALID_EMAIL")
  }

  if (definition?.type === "url" && !/^https?:\/\/\S+\.\S+/.test(value)) {
    throw new PlatformSettingsError("INVALID_URL")
  }
}
