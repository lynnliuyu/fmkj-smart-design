import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import {
  assignPlatformCustomerPlan,
} from "@/lib/account-system/platform-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const customer = await assignPlatformCustomerPlan({
      actorUserId: adminContext.user.userId,
      planCode: String(body.planCode ?? "FREE") as never,
      status: body.status ? (String(body.status) as never) : undefined,
      userId: id,
    })

    return NextResponse.json({ customer })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
