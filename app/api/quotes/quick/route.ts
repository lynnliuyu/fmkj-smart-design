import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  generateQuickQuote,
  QuickQuoteError,
  type QuickModule,
  type QuickTier,
} from "@/lib/quick-quote-service"
import { pointMapApiErrorResponse } from "@/lib/point-map-api"
import { PointMapServiceError } from "@/lib/point-map-service"

export async function POST(request: Request) {
  try {
    const context = await getCurrentAccountContext()
    if (!context) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 })
    }

    const body = await request.json()
    const modules = (Array.isArray(body.modules) ? body.modules : []).filter(
      (value: string): value is QuickModule =>
        ["lights", "switches", "wifi", "sensors", "cameras", "curtains"].includes(value),
    )
    const tier: QuickTier = body.tier === "full" ? "full" : "lite"
    const platform = String(body.platform ?? "").trim() || "通用"
    const bedrooms = Math.max(0, Math.min(10, Number(body.bedrooms ?? 0) || 0))
    const livingRooms = Math.max(0, Math.min(10, Number(body.livingRooms ?? 0) || 0))

    const data = await generateQuickQuote(context, {
      projectId: String(body.projectId ?? "").trim(),
      platform,
      tier,
      bedrooms,
      livingRooms,
      modules,
    })

    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof QuickQuoteError) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    if (error instanceof PointMapServiceError) return pointMapApiErrorResponse(error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QUICK_QUOTE_FAILED" },
      { status: 500 },
    )
  }
}