import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import {
  listPlatformFeatureFlags,
  updatePlatformFeatureFlag,
} from "@/lib/account-system/platform-admin-service"

export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ featureFlags: await listPlatformFeatureFlags() })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const featureFlag = await updatePlatformFeatureFlag({
      actorUserId: context.user.userId,
      description: body.description ? String(body.description) : undefined,
      enabled: Boolean(body.enabled),
      key: String(body.key ?? ""),
    })

    return NextResponse.json({ featureFlag })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
