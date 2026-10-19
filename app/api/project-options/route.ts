import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import { listProjectOptions } from "@/lib/project-options"

export async function GET() {
  const context = await getCurrentAccountContext()

  if (!context) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  return NextResponse.json({
    data: await listProjectOptions(context),
    source: "postgres",
  })
}
