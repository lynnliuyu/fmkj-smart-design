import { NextResponse } from "next/server"
import { del } from "@vercel/blob"

import { getCurrentAccountContext } from "@/lib/account-context"
import { projectVisibilityWhere } from "@/lib/project-access"
import { getPool } from "@/lib/server-db"

type RouteContext = {
  params: Promise<{ id: string; photoId: string }>
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const accountContext = await requireAccountContext()
    const { id, photoId } = await context.params

    if (!(await canAccessProject(accountContext, id))) {
      return NextResponse.json({ error: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 })
    }

    const result = await getPool().query(
      `
      update project_site_photos
      set deleted_at = now()
      where id = $1::uuid
        and project_id = $2::uuid
        and deleted_at is null
      returning blob_url as "blobUrl"
      `,
      [photoId, id],
    )

    if (!result.rowCount || result.rowCount === 0) {
      return NextResponse.json({ error: "SITE_PHOTO_NOT_FOUND" }, { status: 404 })
    }

    const blobUrl = result.rows[0]?.blobUrl
    if (blobUrl && typeof blobUrl === "string") {
      try {
        await del([blobUrl])
      } catch {
        // best-effort deletion; the record is already soft-deleted
      }
    }

    return NextResponse.json({ data: { id: photoId, deleted: true } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SITE_PHOTO_DELETE_FAILED" },
      { status: 500 },
    )
  }
}

async function canAccessProject(
  context: Awaited<ReturnType<typeof getCurrentAccountContext>>,
  projectId: string,
): Promise<boolean> {
  if (!context) return false
  const visibility = projectVisibilityWhere(context, 1)
  const result = await getPool().query(
    `
    select 1
    from projects p
    where p.id = $1::uuid
      and p.deleted_at is null
      and (${visibility.where})
    limit 1
    `,
    [projectId, ...visibility.params],
  )
  return result.rowCount ? result.rowCount > 0 : false
}

async function requireAccountContext() {
  const context = await getCurrentAccountContext()
  if (!context) throw new Error("NOT_AUTHENTICATED")
  return context
}