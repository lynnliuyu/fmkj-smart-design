import { NextRequest, NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { createCatalogLicense, listCatalogLicenses, updateCatalogLicense } from "@/lib/catalog-licenses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 列出所有设备凭据（只有哈希前缀，明文不落库、也读不回来）。 */
export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ licenses: await listCatalogLicenses() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

/** 给一台设备建凭据：明文只在这里返回一次。 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin()
    const body = await request.json().catch(() => ({}))
    const created = await createCatalogLicense({ label: String(body?.label ?? ""), note: body?.note ?? null })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof Error && !("status" in error)) {
      return NextResponse.json({ error: "LICENSE_ERROR", message: error.message }, { status: 400 })
    }
    return adminApiErrorResponse(error)
  }
}

/** 停用/启用或改名。停用比删除好：能看出这台设备曾经存在过。 */
export async function PATCH(request: NextRequest) {
  try {
    await requireSuperAdmin()
    const body = await request.json().catch(() => ({}))
    const license = await updateCatalogLicense({
      id: String(body?.id ?? ""),
      enabled: body?.enabled === undefined ? undefined : Boolean(body.enabled),
      label: body?.label === undefined ? undefined : String(body.label),
      note: body?.note,
    })
    return NextResponse.json({ license })
  } catch (error) {
    if (error instanceof Error && !("status" in error)) {
      return NextResponse.json({ error: "LICENSE_ERROR", message: error.message }, { status: 400 })
    }
    return adminApiErrorResponse(error)
  }
}
