import { NextResponse } from "next/server"
import { getCurrentAccountContext } from "@/lib/account-context"
import { pointMapApiErrorResponse } from "@/lib/point-map-api"
import { PointMapServiceError } from "@/lib/point-map-service"
import { listCategoryDefaultProducts, setCategoryDefaultProduct } from "@/lib/category-default-products-service"

export async function GET(request: Request) {
  try {
    const context = await getCurrentAccountContext()
    if (!context) throw new PointMapServiceError("NOT_AUTHENTICATED", 401)
    const projectId = new URL(request.url).searchParams.get("projectId") ?? ""
    return NextResponse.json({ data: await listCategoryDefaultProducts(context, projectId) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return pointMapApiErrorResponse(error) }
}

export async function PUT(request: Request) {
  try {
    const raw = await request.text()
    if (raw.length > 1024) throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
    let body: { projectId?: unknown; deviceTypeId?: unknown; buttonCount?: unknown; productId?: unknown }
    try { body = JSON.parse(raw) } catch { throw new PointMapServiceError("INVALID_JSON", 400) }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
    await setCategoryDefaultProduct(await getCurrentAccountContext(), { projectId: typeof body.projectId === "string" ? body.projectId : "", deviceTypeId: body.deviceTypeId, buttonCount: body.buttonCount, productId: body.productId ?? null })
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return pointMapApiErrorResponse(error) }
}
