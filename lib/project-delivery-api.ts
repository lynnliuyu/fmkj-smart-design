import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "./account-context"
import { pointMapApiErrorResponse } from "./point-map-api"
import { createProjectDelivery, getProjectDelivery, listProjectDeliveries, previewProjectDelivery, ProjectDeliveryError } from "./project-delivery-service"

type RouteContext = { params: Promise<{ id: string; deliveryId?: string }> }
type Dependencies = {
  getContext?: typeof getCurrentAccountContext
  create?: typeof createProjectDelivery
  preview?: typeof previewProjectDelivery
  list?: typeof listProjectDeliveries
  read?: typeof getProjectDelivery
}

function json(data: unknown) {
  return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } })
}

function errorResponse(error: unknown) {
  if (error instanceof ProjectDeliveryError && error.issues.length) return NextResponse.json(
    { error: error.message, code: error.code, issues: error.issues },
    { status: error.status, headers: { "Cache-Control": "private, no-store" } },
  )
  return pointMapApiErrorResponse(error)
}

export function createProjectDeliveryApiHandlers(dependencies: Dependencies = {}) {
  return {
    async GET(request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        const { id } = await context.params
        const preview = new URL(request.url).searchParams.get("preview") === "1"
        return json(preview
          ? await (dependencies.preview ?? previewProjectDelivery)(account, id)
          : await (dependencies.list ?? listProjectDeliveries)(account, id))
      } catch (error) { return errorResponse(error) }
    },
    async POST(_request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        const { id } = await context.params
        return json(await (dependencies.create ?? createProjectDelivery)(account, id))
      } catch (error) { return errorResponse(error) }
    },
    async DETAIL(_request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        const { id, deliveryId } = await context.params
        return json(await (dependencies.read ?? getProjectDelivery)(account, id, deliveryId ?? ""))
      } catch (error) { return errorResponse(error) }
    },
  }
}
