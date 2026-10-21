import { NextRequest, NextResponse } from "next/server"

import { fileStorage } from "@/lib/file-storage"

const folderByKind: Record<string, string> = {
  avatar: "avatars",
  company_logo: "company-logos",
  contract: "contracts",
  floorplan: "floorplans",
  product_image: "product-images",
  quote_pdf: "quote-pdfs",
}

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

function getAuthenticatedUserId(request: NextRequest): string | null {
  const userId = request.headers.get("x-user-id")
  if (!userId || userId === "undefined" || userId === "null") return null
  return userId
}

// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // --- Auth check (middleware injects x-user-id from JWT) ---
    const userId = getAuthenticatedUserId(request)
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const kind = clean(formData.get("kind")) || "attachment"
    const entityId = clean(formData.get("entityId")) || "general"

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
      kind: folderByKind[kind] ?? "attachments",
      ownerId: entityId,
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

