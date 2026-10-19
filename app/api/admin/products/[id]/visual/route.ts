import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { ProductVisualValidationError } from "@/lib/product-visual-assets"
import { getAdminProductVisualAsset, saveAdminProductVisualAsset } from "@/lib/product-visual-assets-service"

type RouteContext = { params: Promise<{ id: string }> }

function visualErrorResponse(error: unknown) {
  if (error instanceof ProductVisualValidationError) return NextResponse.json({ error: "PRODUCT_VISUAL_VALIDATION_ERROR", details: error.details }, { status: error.status })
  return adminApiErrorResponse(error)
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin()
    const { id } = await context.params
    return NextResponse.json(await getAdminProductVisualAsset(id))
  } catch (error) { return visualErrorResponse(error) }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const admin = await requireSuperAdmin()
    const { id } = await context.params
    let mutation: unknown
    try { mutation = await request.json() }
    catch { throw new ProductVisualValidationError({ visual: "请求内容须为有效 JSON" }) }
    const result = await saveAdminProductVisualAsset({ productId: id, actorUserId: admin.user.userId, mutation })
    return NextResponse.json(result)
  } catch (error) { return visualErrorResponse(error) }
}
