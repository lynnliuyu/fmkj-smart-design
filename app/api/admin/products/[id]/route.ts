import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { productSelectionMutationFields, DEFAULT_PRODUCT_UNIT, deactivateAdminProduct, updateAdminProduct } from "@/lib/product-admin-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const body = await request.json()
    const product = await updateAdminProduct({
      actorUserId: adminContext.user.userId,
      ...productSelectionMutationFields(body),
      brand: body.brand ? String(body.brand) : null,
      category: body.category ? String(body.category) : null,
      channels: Array.isArray(body.channels) ? body.channels.map(String) : splitList(body.channels),
      cost: Number(body.cost ?? 0),
      description: body.description ? String(body.description) : null,
      image: body.image ? String(body.image) : null,
      name: String(body.name ?? ""),
      platform: body.platform ? String(body.platform) : null,
      series: body.series === undefined ? undefined : body.series === null ? null : String(body.series),
      platforms: Array.isArray(body.platforms) ? body.platforms.map(String) : undefined,
      price: Number(body.price ?? 0),
      productId: id,
      sku: String(body.sku ?? ""),
      status: body.status ? (String(body.status) as never) : undefined,
      stock: Number(body.stock ?? 0),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : splitList(body.tags),
      unit: String(body.unit ?? DEFAULT_PRODUCT_UNIT),
    })

    return NextResponse.json({ product })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const adminContext = await requireSuperAdmin()
    const { id } = await context.params
    const product = await deactivateAdminProduct({
      actorUserId: adminContext.user.userId,
      productId: id,
    })

    return NextResponse.json({ product })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

function splitList(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}
