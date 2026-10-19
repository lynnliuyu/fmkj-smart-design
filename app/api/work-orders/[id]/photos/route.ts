import { NextResponse } from "next/server"
import { put } from "@vercel/blob"

import { getCurrentAccountContext } from "@/lib/account-context"
import { projectVisibilityWhere } from "@/lib/project-access"
import { getPool } from "@/lib/server-db"
import { WorkOrderError } from "@/lib/work-order-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
])

export async function GET(_request: Request, context: RouteContext) {
  try {
    const ctx = await requireAccountContext()
    const { id } = await context.params
    if (!(await canAccessWorkOrder(ctx, id))) {
      return NextResponse.json({ error: "WORK_ORDER_NOT_FOUND" }, { status: 404 })
    }

    const result = await getPool().query(
      `select
        psp.id::text as id,
        psp.project_id::text as "projectId",
        psp.blob_url as "blobUrl",
        psp.thumbnail_url as "thumbnailUrl",
        psp.file_name as "fileName",
        psp.content_type as "contentType",
        psp.size_bytes::float8 as "sizeBytes",
        psp.category,
        psp.notes,
        psp.created_at as "createdAt"
      from work_order_photos wop
      join project_site_photos psp on psp.id = wop.photo_id
      where wop.work_order_id = $1::uuid
        and psp.deleted_at is null
      order by psp.created_at desc`,
      [id],
    )
    return NextResponse.json({ data: result.rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WORK_ORDER_PHOTOS_FAILED" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await requireAccountContext()
    const { id } = await context.params
    if (!(await canAccessWorkOrder(ctx, id))) {
      return NextResponse.json({ error: "WORK_ORDER_NOT_FOUND" }, { status: 404 })
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_STORE_NOT_CONFIGURED" }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const notes = String(formData.get("notes") ?? "").trim()

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", maxSize: MAX_FILE_SIZE }, { status: 413 })
    }
    const contentType = file.type || "application/octet-stream"
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json({ error: "FILE_TYPE_NOT_ALLOWED", contentType }, { status: 415 })
    }

    const projectIdRow = await getPool().query(
      `select project_id::text as "projectId" from work_orders where id = $1::uuid`,
      [id],
    )
    const projectId = projectIdRow.rows[0]?.projectId
    if (!projectId) return NextResponse.json({ error: "WORK_ORDER_NOT_FOUND" }, { status: 404 })

    const pathname = `work-orders/${id}/${Date.now()}-${slugFileName(file.name)}`
    const blob = await put(pathname, file, { access: "public", addRandomSuffix: false })

    const insertResult = await getPool().query(
      `insert into project_site_photos (
        project_id, blob_url, blob_pathname, thumbnail_url,
        file_name, content_type, size_bytes, category, notes, created_by
      )
      values ($1::uuid, $2, $3, $4, $5, $6, $7, 'other', $8, $9::uuid)
      returning id::text`,
      [projectId, blob.url, blob.pathname, null, file.name, contentType, file.size, notes || null, ctx.user.userId],
    )
    const photoId = insertResult.rows[0].id

    await getPool().query(
      `insert into work_order_photos (work_order_id, photo_id) values ($1::uuid, $2::uuid) on conflict do nothing`,
      [id, photoId],
    )

    return NextResponse.json({ data: { id: photoId, blobUrl: blob.url, fileName: file.name } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WORK_ORDER_PHOTO_UPLOAD_FAILED" },
      { status: 500 },
    )
  }
}

async function canAccessWorkOrder(
  context: Awaited<ReturnType<typeof getCurrentAccountContext>>,
  workOrderId: string,
): Promise<boolean> {
  if (!context) return false
  const visibility = projectVisibilityWhere(context, 1)
  const result = await getPool().query(
    `select 1
     from work_orders w
     join projects p on p.id = w.project_id
     where w.id = $1::uuid
       and w.deleted_at is null
       and p.deleted_at is null
       and (${visibility.where})`,
    [workOrderId, ...visibility.params],
  )
  return Boolean(result.rowCount && result.rowCount > 0)
}

async function requireAccountContext() {
  const context = await getCurrentAccountContext()
  if (!context) throw new WorkOrderError("NOT_AUTHENTICATED", 401)
  return context
}

function slugFileName(fileName: string) {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : ""
  const baseName = fileName.replace(/\.[^.]+$/, "")
  const safeBaseName =
    baseName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "photo"
  return `${safeBaseName}${extension.toLowerCase()}`
}