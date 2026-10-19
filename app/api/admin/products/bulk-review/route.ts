import { NextRequest, NextResponse } from "next/server"

import { requireSuperAdmin } from "@/lib/admin-auth"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { bulkReviewAdminProducts, parseBulkProductReviewInput, ProductValidationError } from "@/lib/product-admin-service"

const MAX_REQUEST_BYTES = 64 * 1024

export async function POST(request: NextRequest) {
  try {
    const adminContext = await requireSuperAdmin()
    if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
      throw new ProductValidationError({ products: "请求过大，请减少本批产品数量" })
    }
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) {
      throw new ProductValidationError({ products: "请求过大，请减少本批产品数量" })
    }
    let body: unknown
    try { body = JSON.parse(raw) }
    catch { throw new ProductValidationError({ products: "请求不是有效的 JSON" }) }
    const input = parseBulkProductReviewInput(body)
    const result = await bulkReviewAdminProducts({ ...input, actorUserId: adminContext.user.userId })
    return NextResponse.json(result)
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
