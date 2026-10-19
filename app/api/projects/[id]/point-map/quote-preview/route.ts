import { NextResponse } from "next/server"
import { getCurrentAccountContext } from "@/lib/account-context"
import { pointMapApiErrorResponse } from "@/lib/point-map-api"
import { PointMapServiceError } from "@/lib/point-map-service"
import { previewPointMapProcurement } from "@/lib/point-map-procurement-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (Number(request.headers.get("content-length")) > 1024) throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
    const raw = await request.text()
    if (raw.length > 1024) throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
    let body: { expectedRevision?: unknown }
    try { body = JSON.parse(raw) } catch { throw new PointMapServiceError("INVALID_JSON", 400) }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PointMapServiceError("INVALID_POINT_MAP_REQUEST", 400)
    const { id } = await params
    const result = await previewPointMapProcurement(await getCurrentAccountContext(), id, body.expectedRevision)
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return pointMapApiErrorResponse(error) }
}
