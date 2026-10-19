import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { productSelectionMutationFields, DEFAULT_PRODUCT_UNIT, createAdminProduct, listAdminProducts } from "@/lib/product-admin-service"

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin()
    const status = request.nextUrl.searchParams.get("status")

    return NextResponse.json({ products: await listAdminProducts(status) })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const product = await createAdminProduct({
      actorUserId: context.user.userId,
      ...productSelectionMutationFields(body),
      brand: body.brand ? String(body.brand) : null,
      category: body.category ? String(body.category) : null,
      channels: Array.isArray(body.channels) ? body.channels.map(String) : splitList(body.channels),
      cost: Number(body.cost ?? 0),
      description: body.description ? String(body.description) : null,
      image: body.image ? String(body.image) : null,
      name: String(body.name ?? ""),
      platform: body.platform ? String(body.platform) : null,
      price: Number(body.price ?? 0),
      sku: String(body.sku ?? ""),
      status: body.status ? (String(body.status) as never) : "pending_review",
      stock: Number(body.stock ?? 0),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : splitList(body.tags),
      unit: String(body.unit ?? DEFAULT_PRODUCT_UNIT),
    })

    return NextResponse.json({ product }, { status: 201 })
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
