import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  createWorkOrder,
  listWorkOrdersForUser,
  normalizeWorkTypes,
  WorkOrderError,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/lib/work-order-service"

export async function GET(request: Request) {
  try {
    const context = await requireAccountContext()
    const url = new URL(request.url)
    const status = (url.searchParams.get("status") ?? undefined) as WorkOrderStatus | undefined
    const workType = (url.searchParams.get("workType") ?? undefined) as WorkOrderType | undefined
    const projectId = url.searchParams.get("projectId") ?? undefined
    const data = await listWorkOrdersForUser(context, { status, workType, projectId })
    return NextResponse.json({ data })
  } catch (error) {
    return workOrderApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAccountContext()
    const body = await request.json()
    const data = await createWorkOrder(context, {
      projectId: String(body.projectId ?? "").trim(),
      title: String(body.title ?? "").trim(),
      workTypes: normalizeWorkTypes(Array.isArray(body.workTypes) ? body.workTypes : []),
      priority: body.priority,
      assigneeId: body.assigneeId ?? null,
      scheduledAt: body.scheduledAt ?? null,
      items: Array.isArray(body.items) ? body.items : [],
    })
    return NextResponse.json({ data })
  } catch (error) {
    return workOrderApiError(error)
  }
}

async function requireAccountContext() {
  const context = await getCurrentAccountContext()
  if (!context) throw new WorkOrderError("NOT_AUTHENTICATED", 401)
  return context
}

function workOrderApiError(error: unknown) {
  if (error instanceof WorkOrderError) {
    return NextResponse.json({ error: error.code }, { status: error.status })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "WORK_ORDER_FAILED" },
    { status: 500 },
  )
}