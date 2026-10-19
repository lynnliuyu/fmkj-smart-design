import { NextRequest, NextResponse } from "next/server"

import { getCurrentAccountContext } from "@/lib/account-context"
import { ProjectWorkflowError } from "@/lib/project-workflow"
import { createProjectWorkflow } from "@/lib/project-workflow-postgres"

const projectWorkflow = createProjectWorkflow()

export async function GET() {
  try {
    return NextResponse.json(await projectWorkflow.listProjects(await getCurrentAccountContext()))
  } catch (error) {
    if (error instanceof ProjectWorkflowError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      {
        data: [],
        error: error instanceof Error ? error.message : "POSTGRES_PROJECTS_UNAVAILABLE",
        source: "postgres",
      },
      { status: 503 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({
      data: await projectWorkflow.createProject(await request.json(), await getCurrentAccountContext()),
      source: "postgres",
    })
  } catch (error) {
    if (error instanceof ProjectWorkflowError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PROJECT_CREATE_FAILED" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = await request.json()
    const context = await getCurrentAccountContext()

    return NextResponse.json({
      data: await projectWorkflow.applyProjectAction(payload, context),
      source: "postgres",
    })
  } catch (error) {
    if (error instanceof ProjectWorkflowError) {
      const body = error.status === 401 || error.status === 404 ? { error: error.message } : { code: error.code, error: error.message }
      return NextResponse.json(body, { status: error.status })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PROJECT_UPDATE_FAILED" },
      { status: 500 }
    )
  }
}
