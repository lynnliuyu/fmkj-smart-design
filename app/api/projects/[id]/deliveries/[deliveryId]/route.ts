import { createProjectDeliveryApiHandlers } from "@/lib/project-delivery-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = createProjectDeliveryApiHandlers().DETAIL
