import { NextRequest, NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { applyCatalogSync, getCatalogSyncStatus, previewCatalogSync } from "@/lib/catalog-sync-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 只读状态：现在配的是哪个地址、上次同步结果如何。不返回凭据。 */
export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ status: await getCatalogSyncStatus() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

/**
 * `preview` 只拉资料不写库；`apply` 会重新拉一遍再落库——
 * 中间隔着管理员确认，和批量导入是同一条规矩。
 */
export async function POST(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json().catch(() => ({}))

    if (body?.mode === "apply") {
      const applied = await applyCatalogSync(context.user.userId, {}, { updateExisting: body?.updateExisting === true })
      return NextResponse.json(applied, { headers: { "Cache-Control": "no-store" } })
    }

    return NextResponse.json(
      { preview: await previewCatalogSync({}, { updateExisting: body?.updateExisting === true }) },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    // 连不上、凭据过期、摘要不对：把原因原样告诉管理员（页面要显示），但只有自己是管理员的请求才走到这里。
    if (error instanceof Error && !("status" in error)) {
      return NextResponse.json({ error: "CATALOG_SYNC_FAILED", message: error.message }, { status: 502 })
    }
    return adminApiErrorResponse(error)
  }
}
