import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import { canReadLocalFile } from "@/lib/file-access"
import { contentTypeFor, isInlineImage, readLocalFile } from "@/lib/file-storage"
import { projectVisibilityWhere } from "@/lib/project-access"
import { getPool } from "@/lib/server-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ path: string[] }> }

/**
 * 本地存储的附件读取。中间件已强制 /api/* 必须有会话，这里再做归属校验：
 * 合同附件/户型图/报价 PDF 查 project_attachments，
 * 命中后按项目可见性判断；商品图与账号图片属于部署内共享或本人资源。
 */
export async function GET(_request: Request, context: RouteContext) {
  const account = await getCurrentAccountContext()
  if (!account) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })

  const { path: segments } = await context.params
  const pathname = (segments ?? []).join("/")
  if (!pathname) return notFound()

  try {
    const allowed = await canReadLocalFile(pathname, {
      query: async (sql, params) => getPool().query(sql, params as never[]),
      canSeeProject: (projectId) => canAccessProject(account, projectId),
    })
    if (!allowed) return notFound()

    const file = await readLocalFile(pathname)
    if (!file) return notFound()

    const name = pathname.split("/").pop() ?? "file"
    const inline = isInlineImage(name)
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(name),
        "Content-Length": String(file.bytes.byteLength),
        // 授权按会话判定，只能私有缓存。
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        // SVG / PDF / Office 不能在本站源上取得任何能力。
        ...(inline ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
      },
    })
  } catch {
    return notFound()
  }
}

function notFound() {
  return new NextResponse(null, { status: 404 })
}

type Account = NonNullable<Awaited<ReturnType<typeof getCurrentAccountContext>>>

async function canAccessProject(account: Account, projectId: string): Promise<boolean> {
  const visibility = projectVisibilityWhere(account, 1)
  const result = await getPool().query(
    `select 1 from projects p
     where p.id = $1::uuid and p.deleted_at is null and (${visibility.where})
     limit 1`,
    [projectId, ...visibility.params],
  )
  return Boolean(result.rowCount)
}
