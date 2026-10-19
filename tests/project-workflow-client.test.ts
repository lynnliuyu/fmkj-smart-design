import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createProjectClient,
  ProjectWorkflowClientError,
  updateProjectDetailsClient,
} from "../lib/project-workflow-client"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("project workflow client module", () => {
  it("creates Projects through one client interface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: projectPayload({ id: "project-1", name: "自动生成项目名" }),
        })
      )
    )

    await expect(createProjectClient({ customer: "王先生", name: "" })).resolves.toMatchObject({
      id: "project-1",
      name: "自动生成项目名",
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "POST",
      })
    )
  })

  it("adds update-details action behind the client interface", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: projectPayload({ name: "已更新" }) })))

    await updateProjectDetailsClient("project-1", {
      name: "已更新",
      nextActionOwnerName: "项目经理",
      owner: "运营负责人",
      platform: "米家",
    })

    const [, request] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: "update-details",
      id: "project-1",
      name: "已更新",
    })
  })

  it("turns Project workflow failures into caller-facing errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "PROJECT_LIMIT_REACHED", error: "PROJECT_LIMIT_REACHED" }, { status: 403 }))
    )

    await expect(createProjectClient({ name: "第二个项目" })).rejects.toMatchObject(
      new ProjectWorkflowClientError("PROJECT_LIMIT_REACHED", "PROJECT_LIMIT_REACHED", 403)
    )
  })
})

function projectPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    address: "",
    budget: 0,
    building: "",
    code: "P-TEST",
    community: "",
    createdAt: "2026-07-02T00:00:00.000Z",
    customer: "",
    designer: "",
    dueNote: "",
    id: "project-1",
    name: "项目",
    nextAction: "",
    nextActionDueAt: null,
    nextActionOwnerId: null,
    nextActionOwnerName: "",
    owner: "",
    phone: "",
    platform: "",
    quoteAmount: null,
    risk: "normal",
    riskLevel: "normal",
    riskReason: "",
    roomNo: "",
    stage: "new",
    status: "draft",
    tags: [],
    updatedAt: "2026-07-02T00:00:00.000Z",
    waitingOn: "none",
    ...overrides,
  }
}
