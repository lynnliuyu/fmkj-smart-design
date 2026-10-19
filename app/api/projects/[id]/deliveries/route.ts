import { createProjectDeliveryApiHandlers } from "@/lib/project-delivery-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const handlers = createProjectDeliveryApiHandlers()
export const GET = handlers.GET
export const POST = handlers.POST
