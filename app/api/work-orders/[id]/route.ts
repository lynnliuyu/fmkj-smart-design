import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  completeWorkOrder,
  generateCompletionDraft,
  getWorkOrderDetail,
  patchWorkOrder,
  WorkOrderError,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/lib/work-order-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const ctx = await requireAccountContext()
    const { id } = await context.params
    const data = await getWorkOrderDetail(ctx, id)
    return NextResponse.json({ data })
  } catch (error) {
    return workOrderApiError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const ctx = await requireAccountContext()
    const { id } = await context.params
    const body = await request.json()
    const action = String(body.action ?? "").trim()

    if (action === "generate-draft") {
      const draft = await generateCompletionDraft(ctx, id)
      return NextResponse.json({ data: draft })
    }

    const data = await patchWorkOrder(ctx, id, {
      status: (body.status ?? undefined) as WorkOrderStatus | undefined,
      priority: (body.priority ?? undefined) as WorkOrderPriority | undefined,
      assigneeId: body.assigneeId ?? undefined,
      scheduledAt: body.scheduledAt ?? undefined,
      title: body.title,
    })
    return NextResponse.json({ data })
  } catch (error) {
    return workOrderApiError(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await requireAccountContext()
    const { id } = await context.params
    const body = await request.json()
    const action = String(body.action ?? "").trim()

    if (action === "complete") {
      const data = await completeWorkOrder(ctx, id, {
        content: String(body.content ?? ""),
        note: body.note,
        workLines: Array.isArray(body.workLines) ? body.workLines : [],
        actualQuantities: Array.isArray(body.actualQuantities) ? body.actualQuantities : [],
        photoIds: Array.isArray(body.photoIds) ? body.photoIds : [],
      })
      return NextResponse.json({ data })
    }

    throw new WorkOrderError("UNKNOWN_ACTION", 400)
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