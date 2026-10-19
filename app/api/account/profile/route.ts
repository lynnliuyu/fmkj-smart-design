import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import { getSessionUser } from "@/lib/auth"
import { getPool } from "@/lib/server-db"

type ProfileRow = {
  avatar_url: string | null
  company_avatar_url: string | null
  company_id: string | null
  company_name: string | null
  email: string | null
  name: string
  phone: string | null
}

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })

    await ensureProfileSchema()
    const profile = await loadProfile(user.userId)

    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PROFILE_LOAD_FAILED" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getCurrentAccountContext()
    if (!context) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })

    await ensureProfileSchema()

    const body = await request.json()
    const name = clean(body.name)
    const avatarUrl = clean(body.avatarUrl)
    const companyName = clean(body.companyName)
    const companyAvatarUrl = clean(body.companyAvatarUrl)

    if (!name) {
      return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 })
    }

    const db = getPool()
    await db.query(
      `
      update users
      set name = $2,
          avatar_url = nullif($3, ''),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.user.userId, name, avatarUrl]
    )

    if (companyName || companyAvatarUrl) {
      const organizationId = await ensureOrganization(context.user.userId, companyName || `${name}的公司`)
      await db.query(
        `
        update organizations
        set name = coalesce(nullif($2, ''), name),
            avatar_url = nullif($3, ''),
            updated_at = now()
        where id = $1::uuid
        `,
        [organizationId, companyName, companyAvatarUrl]
      )
    }

    const profile = await loadProfile(context.user.userId)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PROFILE_SAVE_FAILED" },
      { status: 500 }
    )
  }
}

async function ensureProfileSchema() {
  await getPool().query("alter table organizations add column if not exists avatar_url text")
}

async function loadProfile(userId: string) {
  const context = await getCurrentAccountContext()
  const result = await getPool().query<ProfileRow>(
    `
    select
      u.name,
      u.email,
      u.phone,
      u.avatar_url,
      o.id::text as company_id,
      o.name as company_name,
      o.avatar_url as company_avatar_url
    from users u
    left join account_profiles ap on ap.user_id = u.id
    left join organization_members om on om.user_id = u.id and om.member_status in ('active', 'invited')
    left join organizations o on o.id = coalesce(ap.organization_id, om.organization_id) and o.status = 'active'
    where u.id = $1::uuid
    limit 1
    `,
    [userId]
  )

  const row = result.rows[0]
  if (!row) throw new Error("PROFILE_NOT_FOUND")

  return {
    accountType: context?.account.type ?? null,
    avatarUrl: row.avatar_url,
    companyAvatarUrl: row.company_avatar_url,
    companyId: row.company_id,
    companyName: row.company_name,
    email: row.email,
    isSuperAdmin: Boolean(context?.account.isSuperAdmin),
    name: row.name,
    permissions: context?.permissions ?? [],
    phone: row.phone,
  }
}

async function ensureOrganization(userId: string, fallbackName: string) {
  const db = getPool()
  const current = await db.query<{ id: string }>(
    `
    select coalesce(ap.organization_id, o.id)::text as id
    from users u
    left join account_profiles ap on ap.user_id = u.id
    left join organization_members om on om.user_id = u.id and om.member_status in ('active', 'invited')
    left join organizations o on (o.id = coalesce(ap.organization_id, om.organization_id) or o.owner_user_id = u.id)
      and o.status = 'active'
    where u.id = $1::uuid
    limit 1
    `,
    [userId]
  )

  if (current.rows[0]?.id) return current.rows[0].id

  const created = await db.query<{ id: string }>(
    `
    insert into organizations (name, owner_user_id, status)
    values ($1, $2::uuid, 'active')
    returning id::text
    `,
    [fallbackName, userId]
  )

  await db.query(
    `
    insert into account_profiles (user_id, account_type, account_status, organization_id)
    values ($1::uuid, 'ENTERPRISE_OWNER', 'active', $2::uuid)
    on conflict (user_id)
    do update set organization_id = excluded.organization_id, updated_at = now()
    `,
    [userId, created.rows[0].id]
  )

  return created.rows[0].id
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}
