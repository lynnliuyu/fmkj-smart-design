import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { updatePlatformPlan } from "@/lib/account-system/platform-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const plan = await updatePlatformPlan({
      actorUserId: adminContext.user.userId,
      isActive: Boolean(body.isActive),
      limits: body.limits,
      name: String(body.name ?? ""),
      planId: id,
      priceCents: Number(body.priceCents ?? 0),
    })

    return NextResponse.json({ plan })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
