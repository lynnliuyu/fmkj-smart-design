import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  getProjectAccessList,
  ProjectAccessError,
  setProjectMemberAccess,
} from "@/lib/project-member-access-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const accountContext = await requireAccountContext()
    const { id } = await context.params
    return NextResponse.json({ access: await getProjectAccessList(accountContext, id) })
  } catch (error) {
    return projectAccessApiErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const accountContext = await requireAccountContext()
    const { id } = await context.params
    const body = await request.json()
    const access = await setProjectMemberAccess({
      accessLevel: body.accessLevel === "view" ? "view" : "edit",
      context: accountContext,
      granted: Boolean(body.granted),
      projectId: id,
      userId: String(body.userId ?? ""),
    })

    return NextResponse.json({ access })
  } catch (error) {
    return projectAccessApiErrorResponse(error)
  }
}

async function requireAccountContext() {
  const context = await getCurrentAccountContext()
  if (!context) throw new ProjectAccessError("NOT_AUTHENTICATED", 401)
  return context
}

function projectAccessApiErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json({ error: error.code }, { status: error.status })
  }

  throw error
}
