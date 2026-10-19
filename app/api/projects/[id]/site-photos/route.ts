import { NextResponse } from "next/server"
import { put } from "@vercel/blob"

import { getCurrentAccountContext } from "@/lib/account-context"
import { projectVisibilityWhere } from "@/lib/project-access"
import { getPool } from "@/lib/server-db"

type RouteContext = {
  params: Promise<{ id: string }>
}

type SitePhotoCategory = "site_entry" | "construction" | "concealed" | "acceptance" | "other"

const CATEGORIES: ReadonlySet<SitePhotoCategory> = new Set([
  "site_entry",
  "construction",
  "concealed",
  "acceptance",
  "other",
])

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

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
    const accountContext = await requireAccountContext()
    const { id } = await context.params

    if (!(await canAccessProject(accountContext, id))) {
      return NextResponse.json({ error: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 })
    }

    const result = await getPool().query(
      `
      select
        psp.id::text as id,
        psp.project_id::text as "projectId",
        psp.blob_url as "blobUrl",
        psp.thumbnail_url as "thumbnailUrl",
        psp.blob_pathname as "blobPathname",
        psp.file_name as "fileName",
        psp.content_type as "contentType",
        psp.size_bytes::float8 as "sizeBytes",
        psp.category,
        psp.notes,
        psp.taken_at as "takenAt",
        psp.created_by::text as "createdBy",
        u.name as "createdByName",
        psp.created_at as "createdAt"
      from project_site_photos psp
      left join users u on u.id = psp.created_by
      where psp.project_id = $1::uuid
        and psp.deleted_at is null
      order by psp.created_at desc
      `,
      [id],
    )

    return NextResponse.json({ data: result.rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SITE_PHOTOS_FETCH_FAILED" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const accountContext = await requireAccountContext()
    const { id } = await context.params

    if (!(await canAccessProject(accountContext, id))) {
      return NextResponse.json({ error: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" }, { status: 404 })
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "BLOB_STORE_NOT_CONFIGURED" }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const category = normalizeCategory(formData.get("category"))
    const notes = clean(formData.get("notes"))
    const takenAtRaw = clean(formData.get("takenAt"))

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "FILE_TOO_LARGE", maxSize: MAX_FILE_SIZE, actualSize: file.size },
        { status: 413 },
      )
    }

    const contentType = file.type || "application/octet-stream"
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json({ error: "FILE_TYPE_NOT_ALLOWED", contentType }, { status: 415 })
    }

    const pathname = `site-photos/${id}/${Date.now()}-${slugFileName(file.name)}`
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
    })

    const takenAt = parseTakenAt(takenAtRaw)
    const createdBy = accountContext.user.userId

    const result = await getPool().query(
      `
      insert into project_site_photos (
        project_id, blob_url, blob_pathname, thumbnail_url,
        file_name, content_type, size_bytes, category, notes, taken_at, created_by
      )
      values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid)
      returning
        id::text as id,
        project_id::text as "projectId",
        blob_url as "blobUrl",
        thumbnail_url as "thumbnailUrl",
        blob_pathname as "blobPathname",
        file_name as "fileName",
        content_type as "contentType",
        size_bytes::float8 as "sizeBytes",
        category,
        notes,
        taken_at as "takenAt",
        created_by::text as "createdBy",
        created_at as "createdAt"
      `,
      [
        id,
        blob.url,
        blob.pathname,
        null,
        file.name,
        contentType,
        file.size,
        category,
        notes || null,
        takenAt,
        createdBy,
      ],
    )

    return NextResponse.json({ data: { ...result.rows[0], createdByName: accountContext.user.name } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SITE_PHOTO_UPLOAD_FAILED" },
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

function normalizeCategory(value: FormDataEntryValue | null): SitePhotoCategory {
  const cleaned = clean(value)
  return CATEGORIES.has(cleaned as SitePhotoCategory) ? (cleaned as SitePhotoCategory) : "other"
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim()
}

function parseTakenAt(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
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