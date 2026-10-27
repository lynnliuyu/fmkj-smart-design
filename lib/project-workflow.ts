import { canCreatePersonalProject, requireAccountPermission } from "./account-gates"
import { accountContextCan, type AccountContext } from "./account-context"
import { canWriteProjectMembership, resolveProjectOwnerScope, type ProjectMembershipAccess, type ProjectOwnerScope } from "./project-access"
import { resolveProjectStage, type ProjectStageResolution } from "./project-stage"
import { rememberProjectCommunity } from "./project-options"
import type { ProjectRiskLevel, ProjectWaitingOn } from "./project-workbench"
import { secondsBetween, type RecordActivityInput } from "./server-activity-log"
import { normalizePropertyType, type PropertyType } from "./project-spaces"

export type ProjectStage =
  | "new"
  | "measure"
  | "proposal"
  | "contract"
  | "install"
  | "acceptance"
  | "aftercare"

export type ProjectRecord = {
  id: string
  name: string
  code: string
  customer: string | null
  phone: string | null
  community: string | null
  building: string | null
  roomNo: string | null
  address: string | null
  platform: string | null
  owner: string | null
  designer: string | null
  budget: number | null
  quoteAmount: number | null
  stageStatusLabel?: string | null
  stage: ProjectStage
  risk: "normal" | "watch" | "blocked"
  riskLevel: ProjectRiskLevel | null
  riskReason: string | null
  dueNote: string | null
  nextAction: string | null
  nextActionDueAt: string | null
  nextActionOwnerId: string | null
  nextActionOwnerName: string | null
  createdAt: string
  updatedAt: string
  waitingOn: ProjectWaitingOn | null
  tags: string[]
  hasAcceptedDelivery?: boolean | null
  hasContract?: boolean | null
  hasPointMap?: boolean | null
  hasProductSelection?: boolean | null
  hasQuote?: boolean | null
  status?: string | null
  propertyType?: PropertyType | null
}

export type NormalizedProjectRecord = Omit<
  ProjectRecord,
  | "address"
  | "budget"
  | "building"
  | "community"
  | "designer"
  | "dueNote"
  | "nextAction"
  | "nextActionOwnerName"
  | "owner"
  | "platform"
  | "quoteAmount"
  | "riskLevel"
  | "riskReason"
  | "roomNo"
  | "waitingOn"
> & {
  address: string
  budget: number
  building: string
  community: string
  designer: string
  dueNote: string
  nextAction: string
  nextActionOwnerName: string
  owner: string
  platform: string
  quoteAmount: number | null
  riskLevel: ProjectRiskLevel
  riskReason: string
  roomNo: string
  stageStatusLabel: string
  waitingOn: ProjectWaitingOn
}

export type CreateProjectWorkflowInput = {
  address?: unknown
  budget?: unknown
  building?: unknown
  community?: unknown
  customer?: unknown
  name?: unknown
  owner?: unknown
  phone?: unknown
  platform?: unknown
  roomNo?: unknown
  unitNo?: unknown
  propertyType?: unknown
}

export type UpdateProjectDetailsInput = {
  building?: unknown
  community?: unknown
  customer?: unknown
  dueNote?: unknown
  name?: unknown
  nextAction?: unknown
  nextActionDueAt?: unknown
  nextActionOwnerName?: unknown
  owner?: unknown
  phone?: unknown
  platform?: unknown
  roomNo?: unknown
}

export type ProjectWorkflowActionInput = UpdateProjectDetailsInput & {
  action?: unknown
  id?: unknown
  risk?: unknown
}

export type ProjectCreateRecordInput = {
  actorUserId: string
  budget: number
  building: string
  code: string
  community: string
  customer: string
  designer: string
  name: string
  nextAction: string
  nextActionOwnerName: string
  owner: string
  ownerScope: ProjectOwnerScope
  phone: string
  platform: string
  progress: number
  roomNo: string
  stage: ProjectStage
  stageLabel: string
  tags: string[]
  propertyType: PropertyType
}

export type ProjectWorkflowRepository = {
  getProjectAccess(projectId: string, context: AccountContext): Promise<ProjectMembershipAccess | null>
  countActivePersonalProjects(userId: string): Promise<number>
  createProject(input: ProjectCreateRecordInput): Promise<ProjectRecord>
  getProjectForStageUpdate(projectId: string): Promise<{
    createdAt: Date | string
    name: string
    stage: ProjectStage
    stageLabel: string | null
  } | null>
  getProjectRisk(projectId: string): Promise<{ name: string; risk: "normal" | "blocked" } | null>
  grantProjectAccess(projectId: string, userId: string): Promise<void>
  listVisibleProjects(context: AccountContext): Promise<ProjectRecord[]>
  updateProjectDetails(input: {
    actorUserId: string
    building: string
    community: string
    customer: string
    dueNote: string
    name: string
    nextAction: string
    nextActionDueAt: string | null
    nextActionOwnerName: string
    owner: string
    phone: string
    platform: string
    projectId: string
    roomNo: string
  }): Promise<ProjectRecord>
  updateProjectRisk(input: {
    actorUserId: string
    projectId: string
    risk: "normal" | "blocked"
    riskReason: string
    statusTone: "error" | "info"
  }): Promise<ProjectRecord>
  updateProjectStage(input: {
    actorUserId: string
    nextAction: string
    progress: number
    projectId: string
    stage: ProjectStage
    stageLabel: string
  }): Promise<ProjectRecord>
}

export type ProjectWorkflowActivityAdapter = {
  record(input: RecordActivityInput): Promise<void>
}

export type ProjectWorkflowDependencies = {
  activity: ProjectWorkflowActivityAdapter
  createProjectCode?: () => string
  now?: () => Date
  repository: ProjectWorkflowRepository
}

const SYSTEM_USER_ID = "10000000-0000-0000-0000-000000000002"
const SYSTEM_ACTOR_NAME = "系统"

const stageMeta: Record<ProjectStage, { label: string; progress: number; nextAction: string }> = {
  acceptance: {
    label: "交付验收",
    nextAction: "整理交付包并安排客户现场验收。",
    progress: 88,
  },
  aftercare: {
    label: "售后维护",
    nextAction: "建立售后回访、保修和维护记录。",
    progress: 100,
  },
  contract: {
    label: "合同收款",
    nextAction: "确认合同、付款节点和开工安排。",
    progress: 48,
  },
  install: {
    label: "安装调试",
    nextAction: "生成施工工单并安排设备到货、安装和调试。",
    progress: 68,
  },
  measure: {
    label: "现场测量",
    nextAction: "完成现场尺寸、网络点位和安装条件复核。",
    progress: 14,
  },
  new: {
    label: "新建跟进",
    nextAction: "补充客户需求、户型图和基础项目信息。",
    progress: 5,
  },
  proposal: {
    label: "方案报价",
    nextAction: "整理设备清单、点位方案和报价初稿。",
    progress: 28,
  },
}

const repairedText: Record<string, string> = {
  "寰呭垎閰?": "待分配",
  "寰呭畾": "待定",
  "寰呰ˉ鍏呬笅涓€姝ユ椂闂?": "待补充下一步时间",
  "椤圭洰缁忕悊": "经理-老板",
  "杩愯惀璐熻矗浜?": "运营负责人",
  "鍦板潃寰呰ˉ鍏?": "地址待补充",
  "鏂伴」鐩?": "新项目",
  "琛ュ厖瀹㈡埛闇€姹傘€佹埛鍨嬪浘鍜屽熀纭€椤圭洰淇℃伅銆?": "补充客户需求、户型图和基础项目信息。",
  "瀹屾垚鐜板満灏哄銆佺綉缁滅偣浣嶅拰瀹夎鏉′欢澶嶆牳銆?": "完成现场尺寸、网络点位和安装条件复核。",
  "鏁寸悊璁惧娓呭崟銆佺偣浣嶆柟妗堝拰鎶ヤ环鍒濈銆?": "整理设备清单、点位方案和报价初稿。",
  "纭鍚堝悓銆佷粯娆捐妭鐐瑰拰寮€宸ュ畨鎺掋€?": "确认合同、付款节点和开工安排。",
  "鐢熸垚鏂藉伐宸ュ崟骞跺畨鎺掕澶囧埌璐с€佸畨瑁呭拰璋冭瘯銆?": "生成施工工单并安排设备到货、安装和调试。",
  "鏁寸悊浜や粯鍖呭苟瀹夋帓瀹㈡埛鐜板満楠屾敹銆?": "整理交付包并安排客户现场验收。",
  "寤虹珛鍞悗鍥炶銆佷繚淇拰缁存姢璁板綍銆?": "建立售后回访、保修和维护记录。",
}

const stageOrder: ProjectStage[] = ["new", "measure", "proposal", "contract", "install", "acceptance", "aftercare"]

export class ProjectWorkflowError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = message,
  ) {
    super(message)
    this.name = "ProjectWorkflowError"
  }
}

export class ProjectWorkflow {
  private readonly activity: ProjectWorkflowActivityAdapter
  private readonly createProjectCode: () => string
  private readonly now: () => Date
  private readonly repository: ProjectWorkflowRepository

  constructor(dependencies: ProjectWorkflowDependencies) {
    this.activity = dependencies.activity
    this.createProjectCode = dependencies.createProjectCode ?? makeProjectCode
    this.now = dependencies.now ?? (() => new Date())
    this.repository = dependencies.repository
  }

  async listProjects(context: AccountContext | null) {
    if (!context) {
      throw new ProjectWorkflowError("UNAUTHORIZED", 401)
    }
    if (context.account.status !== "active") throw new ProjectWorkflowError("ACCOUNT_DISABLED", 403)
    // Expired subscriptions retain read access; account permission gates below are for writes.
    if (!accountContextCan(context, "project.view")) throw new ProjectWorkflowError("PROJECT_VIEW_REQUIRED", 403)

    const projects = await this.repository.listVisibleProjects(context)

    return {
      data: projects.map(normalizeProject),
      source: "postgres",
      total: projects.length,
    }
  }

  async createProject(input: CreateProjectWorkflowInput, context: AccountContext | null) {
    const ownerScope = context ? resolveProjectOwnerScope(context) : null
    const activeProjectCount =
      ownerScope?.ownerType === "user" ? await this.repository.countActivePersonalProjects(ownerScope.ownerId) : 0
    const createGate = canCreatePersonalProject(context, activeProjectCount)

    if (!createGate.allowed) {
      throw new ProjectWorkflowError(
        createGate.reason,
        createGate.reason === "NOT_AUTHENTICATED" ? 401 : 403,
        createGate.reason,
      )
    }

    const actorUserId = context?.user.userId ?? SYSTEM_USER_ID
    const actorName = context?.user.name || SYSTEM_ACTOR_NAME
    const propertyType = normalizePropertyType(input.propertyType) ?? "flat"
    const customer = clean(input.customer)
    const community = clean(input.community) || clean(input.address)
    const building = formatBuildingNamePart(input.building)
    const unitNo = formatUnitNamePart(input.unitNo)
    const room = clean(input.roomNo)
    const roomNo = [unitNo, room].filter(Boolean).join(" ")
    const platform = clean(input.platform) || "待定"
    const name = clean(input.name) || buildProjectName({ building, community, customer, platform, roomNo: room, unitNo }) || "新项目"
    const newStage = stageMeta.new
    const project = await this.repository.createProject({
      actorUserId,
      budget: Number(input.budget || 0),
      building,
      code: this.createProjectCode(),
      community,
      customer,
      designer: "待分配",
      name,
      nextAction: newStage.nextAction,
      nextActionOwnerName: context?.user.name || "经理-老板",
      owner: clean(input.owner) || "运营负责人",
      ownerScope: ownerScope ?? { ownerId: actorUserId, ownerType: "user" },
      phone: clean(input.phone),
      platform,
      progress: newStage.progress,
      roomNo,
      stage: "new",
      stageLabel: newStage.label,
      tags: ["新项目"],
      propertyType,
    })

    await rememberProjectCommunity(community)

    if (ownerScope?.ownerType === "organization" && context) {
      await this.repository.grantProjectAccess(project.id, context.user.userId)
    }

    await this.activity.record({
      action: "project.created",
      actorId: actorUserId,
      actorName,
      description: `${actorName} 创建了项目，当前负责人可以继续补充客户、点位和预算。`,
      entityId: project.id,
      entityLabel: project.name,
      entityType: "project",
      metadata: {
        code: project.code,
        customer: project.customer,
        platform: project.platform,
        stage: project.stage,
      },
      title: `${project.name} 已创建`,
    })

    return normalizeProject(project)
  }

  async applyProjectAction(input: ProjectWorkflowActionInput, context: AccountContext | null) {
    const projectId = clean(input.id)
    const action = clean(input.action)

    if (action === "advance") {
      return this.advanceStage(projectId, context)
    }

    if (action === "toggle-risk") {
      return this.toggleRisk(projectId, input.risk, context)
    }

    if (action === "update-details") {
      return this.updateDetails(projectId, input, context)
    }

    throw new ProjectWorkflowError("UNKNOWN_PROJECT_ACTION", 400)
  }

  async updateDetails(projectId: string, input: UpdateProjectDetailsInput, context: AccountContext | null) {
    await this.assertCanEditProject(projectId, context)

    const community = clean(input.community)
    const project = await this.repository.updateProjectDetails({
      actorUserId: context!.user.userId,
      building: clean(input.building),
      community,
      customer: clean(input.customer),
      dueNote: clean(input.dueNote),
      name: clean(input.name) || "新项目",
      nextAction: clean(input.nextAction),
      nextActionDueAt: normalizeDateInput(input.nextActionDueAt),
      nextActionOwnerName: clean(input.nextActionOwnerName),
      owner: clean(input.owner) || "运营负责人",
      phone: clean(input.phone),
      platform: clean(input.platform) || "待定",
      projectId,
      roomNo: clean(input.roomNo),
    })

    await rememberProjectCommunity(community)
    await this.activity.record({
      action: "project.updated",
      actorId: context!.user.userId,
      actorName: context!.user.name,
      description: `${context!.user.name} 更新了项目资料和下一步安排。`,
      entityId: project.id,
      entityLabel: project.name,
      entityType: "project",
      metadata: {
        customer: project.customer,
        platform: project.platform,
        stage: project.stage,
      },
      title: `${project.name} 已更新`,
    })

    return normalizeProject(project)
  }

  async advanceStage(projectId: string, context: AccountContext | null) {
    await this.assertCanEditProject(projectId, context)

    const currentProject = await this.repository.getProjectForStageUpdate(projectId)
    const currentStage = currentProject?.stage ?? "new"
    const nextStage = stageOrder[Math.min(stageOrder.indexOf(currentStage) + 1, stageOrder.length - 1)]
    const meta = stageMeta[nextStage]
    const occurredAt = this.now()
    const project = await this.repository.updateProjectStage({
      actorUserId: context!.user.userId,
      nextAction: meta.nextAction,
      progress: meta.progress,
      projectId,
      stage: nextStage,
      stageLabel: meta.label,
    })

    await this.activity.record({
      action: "project.stage_advanced",
      actorId: context!.user.userId,
      actorName: context!.user.name,
      description: `${context!.user.name} 将项目推进到 ${meta.label}。`,
      durationSeconds: currentProject ? secondsBetween(currentProject.createdAt, occurredAt) : null,
      entityId: project.id,
      entityLabel: project.name,
      entityType: "project",
      metadata: {
        fromStage: currentStage,
        fromStageLabel: currentProject?.stageLabel,
        toStage: nextStage,
        toStageLabel: meta.label,
      },
      occurredAt,
      title: `${project.name} 阶段已推进`,
    })

    return normalizeProject(project)
  }

  async toggleRisk(projectId: string, inputRisk: unknown, context: AccountContext | null) {
    await this.assertCanEditProject(projectId, context)

    const risk = inputRisk === "blocked" ? "normal" : "blocked"
    const current = await this.repository.getProjectRisk(projectId)
    const project = await this.repository.updateProjectRisk({
      actorUserId: context!.user.userId,
      projectId,
      risk,
      riskReason: "手动标记为阻塞",
      statusTone: risk === "blocked" ? "error" : "info",
    })

    await this.activity.record({
      action: "project.risk_toggled",
      actorId: context!.user.userId,
      actorName: context!.user.name,
      description:
        risk === "blocked"
          ? `${context!.user.name} 将项目标记为阻塞，需要优先处理。`
          : `${context!.user.name} 解除项目阻塞，项目可以继续推进。`,
      entityId: project.id,
      entityLabel: project.name,
      entityType: "project",
      metadata: {
        fromRisk: current?.risk ?? "normal",
        toRisk: risk,
      },
      title: risk === "blocked" ? `${project.name} 有阻塞` : `${project.name} 阻塞已解除`,
    })

    return normalizeProject(project)
  }

  private async assertCanEditProject(projectId: string, context: AccountContext | null): Promise<void> {
    if (!projectId) {
      throw new ProjectWorkflowError("PROJECT_ID_REQUIRED", 400)
    }

    if (!context) {
      throw new ProjectWorkflowError("UNAUTHORIZED", 401)
    }

    const access = await this.repository.getProjectAccess(projectId, context)
    if (!access) {
      throw new ProjectWorkflowError("RESOURCE_NOT_FOUND_OR_NOT_OWNED", 404)
    }

    const editGate = requireAccountPermission(context, "project.edit")
    if (!editGate.allowed) {
      throw new ProjectWorkflowError(
        editGate.reason,
        editGate.reason === "NOT_AUTHENTICATED" ? 401 : 403,
        editGate.reason,
      )
    }
    if (!canWriteProjectMembership(context, access)) {
      throw new ProjectWorkflowError("PROJECT_READ_ONLY", 403)
    }
  }
}

export function normalizeProject(project: ProjectRecord): NormalizedProjectRecord {
  const resolvedStage = resolveProjectStage({
    hasAcceptedDelivery: Boolean(project.hasAcceptedDelivery),
    hasContract: Boolean(project.hasContract),
    hasPointMap: Boolean(project.hasPointMap),
    hasProductSelection: Boolean(project.hasProductSelection),
    hasQuote: Boolean(project.hasQuote || project.quoteAmount),
    projectStatus: project.status,
  })

  return {
    ...project,
    propertyType: normalizePropertyType(project.propertyType),
    address: repairText(project.address) || "地址待补充",
    budget: Number(project.budget ?? 0),
    building: repairText(project.building),
    community: repairText(project.community),
    designer: repairText(project.designer),
    dueNote: repairText(project.dueNote) || "待补充下一步时间",
    nextAction: repairText(project.nextAction) || stageMeta[project.stage]?.nextAction || "",
    nextActionOwnerName: repairText(project.nextActionOwnerName) || repairText(project.owner),
    owner: repairText(project.owner),
    platform: repairText(project.platform),
    quoteAmount: project.quoteAmount === null ? null : Number(project.quoteAmount),
    riskLevel: project.riskLevel || project.risk,
    riskReason: repairText(project.riskReason),
    roomNo: repairText(project.roomNo),
    stage: resolvedStage.stage,
    stageStatusLabel: stageStatusLabel(project, resolvedStage),
    tags: Array.isArray(project.tags) ? project.tags.map(repairText) : [],
    waitingOn: project.waitingOn || "none",
  }
}

function stageStatusLabel(project: ProjectRecord, resolvedStage: ProjectStageResolution) {
  if (project.status === "paused" || project.status === "on_hold") return "暂停中"
  return resolvedStage.statusLabel
}

function makeProjectCode() {
  return `P-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function buildProjectName(input: {
  building: string
  community: string
  customer: string
  platform: string
  roomNo: string
  unitNo: string
}) {
  const location = [input.community, input.building, input.unitNo, input.roomNo].filter(Boolean).join(" ")
  return [location, input.customer, input.platform === "待定" ? "" : input.platform].filter(Boolean).join(" ")
}

function formatBuildingNamePart(value: unknown) {
  return appendChineseSuffix(value, ["栋", "幢", "座"], "栋")
}

function formatUnitNamePart(value: unknown) {
  return appendChineseSuffix(value, ["单元"], "单元")
}

function appendChineseSuffix(value: unknown, suffixes: string[], suffix: string) {
  const text = clean(value)
  if (!text) return ""
  return suffixes.some((item) => text.endsWith(item)) ? text : `${text}${suffix}`
}

function normalizeDateInput(value: unknown) {
  const text = clean(value)
  if (!text) return null

  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return null

  return date.toISOString()
}

function repairText(value: string | null | undefined) {
  const text = value ?? ""
  return repairedText[text] ?? text
}
