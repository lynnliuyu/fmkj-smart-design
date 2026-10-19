import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import {
  createPlatformCustomer,
  listPlatformCustomers,
} from "@/lib/account-system/platform-admin-service"

export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ customers: await listPlatformCustomers() })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const customer = await createPlatformCustomer({
      accountType: String(body.accountType ?? "PERSONAL_FREE") as never,
      actorUserId: context.user.userId,
      email: String(body.email ?? ""),
      name: String(body.name ?? ""),
      password: body.password ? String(body.password) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      planCode: String(body.planCode ?? "FREE") as never,
    })

    return NextResponse.json({ customer }, { status: 201 })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
