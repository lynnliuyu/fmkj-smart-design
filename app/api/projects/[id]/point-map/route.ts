import { createPointMapApiHandlers } from "@/lib/point-map-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const handlers = createPointMapApiHandlers()
export const GET = handlers.GET
export const PUT = handlers.PUT
