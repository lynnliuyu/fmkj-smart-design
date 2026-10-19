import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { assignPlatformOrganizationPlan } from "@/lib/account-system/platform-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const organization = await assignPlatformOrganizationPlan({
      actorUserId: adminContext.user.userId,
      organizationId: id,
      planCode: String(body.planCode ?? "ENTERPRISE_MONTHLY") as never,
      status: body.status ? (String(body.status) as never) : undefined,
    })

    return NextResponse.json({ organization })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
