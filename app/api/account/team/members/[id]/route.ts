import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  AccountTeamError,
  updateTeamMember,
  type TeamRoleCode,
} from "@/lib/account-team-service"
import type { MemberStatus } from "@/lib/account-system/domain"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const accountContext = await requireAccountContext()
    const { id } = await context.params
    const body = await request.json()
    const team = await updateTeamMember({
      context: accountContext,
      memberId: id,
      roleCode: body.roleCode ? (String(body.roleCode) as TeamRoleCode) : undefined,
      status: body.status ? (String(body.status) as Extract<MemberStatus, "active" | "disabled">) : undefined,
      transferToUserId: body.transferToUserId ? String(body.transferToUserId) : undefined,
    })

    return NextResponse.json({ team })
  } catch (error) {
    return accountTeamApiErrorResponse(error)
  }
}

async function requireAccountContext() {
  const context = await getCurrentAccountContext()
  if (!context) throw new AccountTeamError("NOT_AUTHENTICATED", 401)
  return context
}

function accountTeamApiErrorResponse(error: unknown) {
  if (error instanceof AccountTeamError) {
    return NextResponse.json({ error: error.code }, { status: error.status })
  }

  throw error
}
