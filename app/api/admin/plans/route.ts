import { NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { listPlatformPlans } from "@/lib/account-system/platform-admin-service"

export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ plans: await listPlatformPlans() })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
