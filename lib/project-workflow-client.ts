import type { NormalizedProjectRecord, UpdateProjectDetailsInput } from "./project-workflow"

export type ProjectListResponse = {
  data?: NormalizedProjectRecord[]
  error?: string
  source?: string
  total?: number
}

export class ProjectWorkflowClientError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly status: number
  ) {
    super(message)
    this.name = "ProjectWorkflowClientError"
  }
}

export async function listProjectsClient<TProject = NormalizedProjectRecord>() {
  const payload = await requestProjectWorkflow<ProjectListResponse>("/api/projects", { cache: "no-store" })
  return (payload.data ?? []) as TProject[]
}

export async function createProjectClient<TProject = NormalizedProjectRecord>(input: Record<string, FormDataEntryValue>) {
  const payload = await requestProjectWorkflow<{ code?: string; data?: NormalizedProjectRecord; error?: string }>(
    "/api/projects",
    {
      body: input,
      method: "POST",
    }
  )
  return requireProject<TProject>(payload.data as TProject | undefined, payload.code ?? payload.error)
}

export async function updateProjectDetailsClient<TProject = NormalizedProjectRecord>(
  projectId: string,
  input: UpdateProjectDetailsInput & {
    nextActionOwnerName: string
    owner: string
    platform: string
  }
) {
  const payload = await requestProjectWorkflow<{ data?: NormalizedProjectRecord; error?: string }>("/api/projects", {
    body: {
      ...input,
      action: "update-details",
      id: projectId,
    },
    method: "PATCH",
  })
  return requireProject<TProject>(payload.data as TProject | undefined, payload.error)
}

async function requestProjectWorkflow<T>(
  url: string,
  options: { body?: unknown; cache?: RequestCache; method?: "GET" | "PATCH" | "POST" } = {}
): Promise<T> {
  const response = await fetch(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: options.cache,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    method: options.method ?? "GET",
  })
  const payload = (await response.json().catch(() => ({}))) as T & {
    code?: string
    error?: string
  }

  if (!response.ok) {
    throw new ProjectWorkflowClientError(
      payload.error ?? payload.code ?? "PROJECT_WORKFLOW_FAILED",
      payload.code ?? payload.error,
      response.status
    )
  }

  return payload
}

function requireProject<TProject>(project: TProject | null | undefined, code?: string) {
  if (!project) {
    throw new ProjectWorkflowClientError(code ?? "PROJECT_WORKFLOW_FAILED", code, 500)
  }

  return project
}
