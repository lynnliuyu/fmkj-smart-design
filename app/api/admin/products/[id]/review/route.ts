import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { reviewAdminProduct } from "@/lib/product-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const product = await reviewAdminProduct({
      actorUserId: adminContext.user.userId,
      note: body.note ? String(body.note) : undefined,
      productId: id,
      status: String(body.status ?? "approved") === "rejected" ? "rejected" : "approved",
    })

    return NextResponse.json({ product })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
