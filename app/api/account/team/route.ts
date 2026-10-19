import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import {
  AccountTeamError,
  createTeamMember,
  getAccountTeam,
  type TeamRoleCode,
} from "@/lib/account-team-service"

export async function GET() {
  try {
    const context = await requireAccountContext()
    return NextResponse.json({ team: await getAccountTeam(context) })
  } catch (error) {
    return accountTeamApiErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAccountContext()
    const body = await request.json()
    const team = await createTeamMember({
      context,
      email: String(body.email ?? ""),
      name: body.name ? String(body.name) : undefined,
      password: body.password ? String(body.password) : undefined,
      roleCode: String(body.roleCode ?? "editor") as TeamRoleCode,
    })

    return NextResponse.json({ team }, { status: 201 })
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
