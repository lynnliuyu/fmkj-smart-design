import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import {
  getPlatformCustomer,
  updatePlatformCustomer,
} from "@/lib/account-system/platform-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin()
    const { id } = await context.params
    const customer = await getPlatformCustomer(id)

    if (!customer) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    return NextResponse.json({ customer })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const customer = await updatePlatformCustomer({
      accountStatus: String(body.accountStatus ?? "active") as never,
      accountType: String(body.accountType ?? "PERSONAL_FREE") as never,
      actorUserId: adminContext.user.userId,
      userId: id,
    })

    return NextResponse.json({ customer })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
