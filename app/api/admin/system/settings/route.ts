import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { listPlatformSettings, updatePlatformSettings } from "@/lib/platform-settings"

export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ settings: await listPlatformSettings() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const settings = await updatePlatformSettings({
      actorUserId: context.user.userId,
      values: body.values ?? {},
    })

    return NextResponse.json({ settings })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
