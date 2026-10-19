import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  addCustomPricingItem,
  deleteCustomPricingItem,
  listPricingForOrganization,
  upsertPricingOverride,
  WorkOrderError,
  type WorkOrderType,
  type WorkPricingMode,
} from "@/lib/work-order-service"

export async function GET(request: Request) {
  try {
    const context = await requireAccountContext()
    const url = new URL(request.url)
    const workTypesParam = url.searchParams.get("workTypes") ?? ""
    const workTypes = workTypesParam
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) as WorkOrderType[]
    const data = await listPricingForOrganization(context, workTypes)
    return NextResponse.json({ data })
  } catch (error) {
    return workOrderApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAccountContext()
    const body = await request.json()
    const action = String(body.action ?? "").trim()

    if (action === "override") {
      await upsertPricingOverride(context, {
        catalogCode: String(body.catalogCode ?? "").trim(),
        name: body.name,
        pricingMode: body.pricingMode as WorkPricingMode | undefined,
        unitPriceCents: Number(body.unitPriceCents ?? 0),
        unitName: body.unitName,
        isHidden: Boolean(body.isHidden ?? false),
      })
      return NextResponse.json({ data: { ok: true } })
    }

    if (action === "custom") {
      await addCustomPricingItem(context, {
        workType: body.workType as WorkOrderType,
        name: String(body.name ?? "").trim(),
        description: body.description,
        pricingMode: body.pricingMode as WorkPricingMode,
        unitPriceCents: Number(body.unitPriceCents ?? 0),
        unitName: body.unitName,
      })
      return NextResponse.json({ data: { ok: true } })
    }

    if (action === "delete-custom") {
      await deleteCustomPricingItem(context, String(body.id ?? "").trim())
      return NextResponse.json({ data: { ok: true } })
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
    { error: error instanceof Error ? error.message : "PRICING_FAILED" },
    { status: 500 },
  )
}