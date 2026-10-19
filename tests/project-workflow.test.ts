import { describe, expect, it } from "vitest"

import { buildAccountContext } from "../lib/account-context.js"
import {
  ProjectWorkflow,
  type ProjectCreateRecordInput,
  type ProjectRecord,
  type ProjectWorkflowActivityAdapter,
  type ProjectWorkflowRepository,
} from "../lib/project-workflow.js"
import type { RecordActivityInput } from "../lib/server-activity-log.js"
import type { AuthUser } from "../lib/auth.js"

const sessionUser: AuthUser = {
  email: "member@example.com",
  name: "Member",
  phone: null,
  role: "member",
  userId: "10000000-0000-0000-0000-000000000001",
}

describe("project workflow", () => {
  it("creates a personal project and records the Project event", async () => {
    const repository = new MemoryProjectWorkflowRepository()
    const activity = new MemoryProjectActivityAdapter()
    const workflow = new ProjectWorkflow({
      activity,
      createProjectCode: () => "P-20260630-TEST",
      repository,
    })
    const context = buildAccountContext(sessionUser)

    const project = await workflow.createProject(
      {
        budget: 120000,
        customer: "Customer",
        name: "Smart Home",
        phone: "13800000000",
      },
      context
    )

    expect(project).toMatchObject({
      budget: 120000,
      code: "P-20260630-TEST",
      customer: "Customer",
      name: "Smart Home",
      stage: "new",
    })
    expect(repository.projects[0]).toMatchObject({
      owner: "运营负责人",
      ownerScope: { ownerId: sessionUser.userId, ownerType: "user" },
    })
    expect(activity.records[0]).toMatchObject({
      action: "project.created",
      entityLabel: "Smart Home",
      metadata: {
        code: "P-20260630-TEST",
        stage: "new",
      },
    })
  })

  it("generates a project name from submitted project details when name is blank", async () => {
    const repository = new MemoryProjectWorkflowRepository()
    const workflow = new ProjectWorkflow({
      activity: new MemoryProjectActivityAdapter(),
      createProjectCode: () => "P-20260701-TEST",
      repository,
    })

    const project = await workflow.createProject(
      {
        building: "2",
        community: "星河湾",
        customer: "王先生",
        name: "",
        platform: "米家",
        roomNo: "1201",
        unitNo: "1",
      },
      buildAccountContext(sessionUser)
    )

    expect(project.name).toBe("星河湾 2栋 1单元 1201 王先生 米家")
    expect(project.building).toBe("2栋")
    expect(project.roomNo).toBe("1单元 1201")
    expect(repository.projects[0].name).toBe("星河湾 2栋 1单元 1201 王先生 米家")
  })

  it("rejects a second project for a personal free account", async () => {
    const repository = new MemoryProjectWorkflowRepository([
      projectRecord({ id: "project_1" }),
    ])
    const workflow = new ProjectWorkflow({
      activity: new MemoryProjectActivityAdapter(),
      repository,
    })

    await expect(
      workflow.createProject({ name: "Second Project" }, buildAccountContext(sessionUser))
    ).rejects.toMatchObject({
      code: "PROJECT_LIMIT_REACHED",
      status: 403,
    })
  })

  it("records manual stage advances without overriding the automatic display stage", async () => {
    const repository = new MemoryProjectWorkflowRepository([
      projectRecord({
        createdAt: "2026-06-30T08:00:00.000Z",
        id: "project_1",
        risk: "blocked",
        riskLevel: "blocked",
        stage: "proposal",
      }),
    ])
    const activity = new MemoryProjectActivityAdapter()
    const workflow = new ProjectWorkflow({
      activity,
      now: () => new Date("2026-06-30T10:00:00.000Z"),
      repository,
    })

    const project = await workflow.advanceStage("project_1", buildAccountContext(sessionUser))

    expect(project).toMatchObject({
      id: "project_1",
      riskLevel: "watch",
      stage: "new",
      stageStatusLabel: "新建跟进",
    })
    expect(repository.projects[0]).toMatchObject({ stage: "contract" })
    expect(activity.records[0]).toMatchObject({
      action: "project.stage_advanced",
      durationSeconds: 7200,
      metadata: {
        fromStage: "proposal",
        toStage: "contract",
      },
    })
  })

  it("toggles Project risk and keeps the old risk in the event metadata", async () => {
    const repository = new MemoryProjectWorkflowRepository([
      projectRecord({ id: "project_1", risk: "normal", riskLevel: "normal" }),
    ])
    const activity = new MemoryProjectActivityAdapter()
    const workflow = new ProjectWorkflow({ activity, repository })

    const project = await workflow.toggleRisk("project_1", "normal", buildAccountContext(sessionUser))

    expect(project).toMatchObject({
      id: "project_1",
      riskLevel: "blocked",
      riskReason: "手动标记为阻塞",
    })
    expect(activity.records[0]).toMatchObject({
      action: "project.risk_toggled",
      metadata: {
        fromRisk: "normal",
        toRisk: "blocked",
      },
    })
  })

  it("updates project details and next action fields", async () => {
    const repository = new MemoryProjectWorkflowRepository([
      projectRecord({
        customer: "Old Customer",
        id: "project_1",
        nextAction: "Old step",
        owner: "运营负责人",
        platform: "待定",
      }),
    ])
    const activity = new MemoryProjectActivityAdapter()
    const workflow = new ProjectWorkflow({ activity, repository })

    const project = await workflow.updateDetails(
      "project_1",
      {
        building: "2栋",
        community: "星河湾",
        customer: "New Customer",
        dueNote: "本周内完成",
        name: "Updated Project",
        nextAction: "联系客户确认方案",
        nextActionDueAt: "2026-07-03",
        nextActionOwnerName: "项目经理",
        owner: "项目经理",
        phone: "13800138000",
        platform: "米家",
        roomNo: "1201",
      },
      buildAccountContext(sessionUser),
    )

    expect(project).toMatchObject({
      building: "2栋",
      community: "星河湾",
      customer: "New Customer",
      dueNote: "本周内完成",
      name: "Updated Project",
      nextAction: "联系客户确认方案",
      nextActionOwnerName: "项目经理",
      owner: "项目经理",
      phone: "13800138000",
      platform: "米家",
      roomNo: "1201",
    })
    expect(activity.records.at(-1)).toMatchObject({
      action: "project.updated",
      entityLabel: "Updated Project",
    })
  })

  it("dispatches Project lifecycle actions behind the workflow interface", async () => {
    const repository = new MemoryProjectWorkflowRepository([
      projectRecord({ id: "project_1", risk: "normal", riskLevel: "normal" }),
    ])
    const workflow = new ProjectWorkflow({
      activity: new MemoryProjectActivityAdapter(),
      repository,
    })

    const project = await workflow.applyProjectAction(
      {
        action: "toggle-risk",
        id: "project_1",
        risk: "normal",
      },
      buildAccountContext(sessionUser)
    )

    expect(project).toMatchObject({
      id: "project_1",
      riskLevel: "blocked",
    })
  })

  it("rejects unknown Project lifecycle actions inside the workflow module", async () => {
    const workflow = new ProjectWorkflow({
      activity: new MemoryProjectActivityAdapter(),
      repository: new MemoryProjectWorkflowRepository([projectRecord({ id: "project_1" })]),
    })

    await expect(
      workflow.applyProjectAction(
        {
          action: "unexpected",
          id: "project_1",
        },
        buildAccountContext(sessionUser)
      )
    ).rejects.toMatchObject({
      code: "UNKNOWN_PROJECT_ACTION",
      status: 400,
    })
  })
})

class MemoryProjectActivityAdapter implements ProjectWorkflowActivityAdapter {
  readonly records: RecordActivityInput[] = []

  async record(input: RecordActivityInput) {
    this.records.push(input)
  }
}

class MemoryProjectWorkflowRepository implements ProjectWorkflowRepository {
  readonly projects: Array<ProjectRecord & { ownerScope?: ProjectCreateRecordInput["ownerScope"] }> = []

  constructor(projects: ProjectRecord[] = []) {
    this.projects.push(...projects)
  }

  async listVisibleProjects() {
    return this.projects
  }

  async countActivePersonalProjects() {
    return this.projects.length
  }

  async createProject(input: ProjectCreateRecordInput) {
    const project = projectRecord({
      budget: input.budget,
      building: input.building,
      code: input.code,
      community: input.community,
      customer: input.customer,
      designer: input.designer,
      id: "project_1",
      name: input.name,
      nextAction: input.nextAction,
      nextActionOwnerName: input.nextActionOwnerName,
      owner: input.owner,
      phone: input.phone,
      platform: input.platform,
      roomNo: input.roomNo,
      stage: input.stage,
      tags: input.tags,
    })
    this.projects.push({ ...project, ownerScope: input.ownerScope })
    return project
  }

  async grantProjectAccess() {}

  async canAccessProject(projectId: string) {
    return this.projects.some((project) => project.id === projectId)
  }

  async getProjectForStageUpdate(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId)
    if (!project) return null

    return {
      createdAt: project.createdAt,
      name: project.name,
      stage: project.stage,
      stageLabel: project.stage,
    }
  }

  async updateProjectStage(input: Parameters<ProjectWorkflowRepository["updateProjectStage"]>[0]) {
    const project = this.requireProject(input.projectId)
    project.stage = input.stage
    project.nextAction = input.nextAction
    project.risk = project.risk === "blocked" ? "watch" : project.risk
    project.riskLevel = project.riskLevel === "blocked" ? "watch" : project.riskLevel
    return project
  }

  async updateProjectDetails(input: Parameters<ProjectWorkflowRepository["updateProjectDetails"]>[0]) {
    const project = this.requireProject(input.projectId)
    project.name = input.name
    project.customer = input.customer
    project.phone = input.phone
    project.community = input.community
    project.building = input.building
    project.roomNo = input.roomNo
    project.address = [input.community, input.building, input.roomNo].filter(Boolean).join(" ")
    project.owner = input.owner
    project.platform = input.platform
    project.nextAction = input.nextAction
    project.nextActionOwnerName = input.nextActionOwnerName
    project.nextActionDueAt = input.nextActionDueAt
    project.dueNote = input.dueNote
    return project
  }

  async getProjectRisk(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId)
    const risk: "normal" | "blocked" = project?.risk === "blocked" ? "blocked" : "normal"
    return project ? { name: project.name, risk } : null
  }

  async updateProjectRisk(input: Parameters<ProjectWorkflowRepository["updateProjectRisk"]>[0]) {
    const project = this.requireProject(input.projectId)
    project.risk = input.risk
    project.riskLevel = input.risk
    project.riskReason = input.risk === "blocked" ? input.riskReason : ""
    return project
  }

  private requireProject(projectId: string) {
    const project = this.projects.find((item) => item.id === projectId)
    if (!project) throw new Error("PROJECT_NOT_FOUND")
    return project
  }
}

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    address: "",
    budget: 0,
    code: "P-20260630-TEST",
    createdAt: "2026-06-30T08:00:00.000Z",
    customer: "",
    community: "",
    building: "",
    designer: "",
    dueNote: "",
    id: "project_1",
    name: "Smart Home",
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
    updatedAt: "2026-06-30T08:00:00.000Z",
    waitingOn: "none",
    ...overrides,
  }
}
