import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import { fileStorage } from "@/lib/file-storage"
import { canWriteProjectMembership, projectVisibilityWhere, type ProjectMembershipAccess } from "@/lib/project-access"
import { getPool } from "@/lib/server-db"
import { authorizeUpload } from "@/lib/upload-access"

// --- Security guards -------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Plain text
  "text/plain",
  "text/csv",
])

// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // 归属授权看的是会话里的账号，不再只信中间件塞进来的 x-user-id 头。
    const context = await getCurrentAccountContext()
    if (!context) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const kind = clean(formData.get("kind")) || "attachment"
    const entityId = clean(formData.get("entityId")) || "general"

    const access = await authorizeUpload(context, kind, entityId, {
      canEditProject: (projectId) => canEditProject(context, projectId),
      productExists: (productId) => productExists(productId),
    })
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 })
    }

    // --- Size limit ---
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "FILE_TOO_LARGE", maxSize: MAX_FILE_SIZE, actualSize: file.size },
        { status: 413 }
      )
    }

    // --- Type whitelist ---
    const contentType = file.type || "application/octet-stream"
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "FILE_TYPE_NOT_ALLOWED", contentType },
        { status: 415 }
      )
    }

    const stored = await fileStorage().save({
      kind: access.folder,
      ownerId: access.ownerId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType,
    })

    return NextResponse.json({
      data: {
        contentType,
        downloadUrl: stored.downloadUrl,
        fileName: file.name,
        kind,
        pathname: stored.pathname,
        size: stored.size,
        url: stored.url,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UPLOAD_FAILED" },
      { status: 500 }
    )
  }
}

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 能不能把文件挂到这个项目上：项目可见性 + project.edit 权限，和别处同一套规则。 */
async function canEditProject(context: NonNullable<Awaited<ReturnType<typeof getCurrentAccountContext>>>, projectId: string) {
  if (!UUID.test(projectId)) return false
  try {
    const visibility = projectVisibilityWhere(context, 1)
    const actorParameter = `$${visibility.params.length + 2}`
    const result = await getPool().query<ProjectMembershipAccess>(
      `select p.created_by::text as "createdBy",
        (select pm.access_level::text from project_members pm
         where pm.project_id = p.id and pm.user_id = ${actorParameter}::uuid and pm.status = 'active'
         limit 1) as "accessLevel"
       from projects p where p.id = $1::uuid and p.deleted_at is null and (${visibility.where})`,
      [projectId, ...visibility.params, context.user.userId],
    )
    return Boolean(result.rows[0] && canWriteProjectMembership(context, result.rows[0]))
  } catch {
    return false
  }
}

async function productExists(productId: string) {
  try {
    const result = await getPool().query("select 1 from products where id = $1::uuid and deleted_at is null", [productId])
    return Boolean(result.rowCount)
  } catch {
    return false
  }
}

