export type ProjectRiskLevel = "normal" | "watch" | "blocked"
export type ProjectWaitingOn = "none" | "customer" | "internal" | "vendor"
export type ProjectWorkbenchGroupKey = "risk" | "upcoming" | "waiting" | "active"

export type ProjectWorkbenchInput = {
  deletedAt?: Date | null | string
  id: string
  nextActionDueAt?: Date | null | string
  risk?: ProjectRiskLevel | null
  riskLevel?: ProjectRiskLevel | null
  stage?: string | null
  status?: string | null
  updatedAt?: Date | null | string
  waitingOn?: ProjectWaitingOn | null | string
  hasOpenAftercareTask?: boolean
}

export type NormalizedProjectWorkbenchProject<T extends ProjectWorkbenchInput = ProjectWorkbenchInput> = T & {
  nextActionDueAtTime: number | null
  projectRiskLevel: ProjectRiskLevel
  projectWaitingOn: ProjectWaitingOn
  updatedAtTime: number
}

export type ProjectWorkbenchGroups<T extends ProjectWorkbenchInput = ProjectWorkbenchInput> = Record<
  ProjectWorkbenchGroupKey,
  NormalizedProjectWorkbenchProject<T>[]
>

const upcomingWindowMs = 3 * 24 * 60 * 60 * 1000
const riskRank: Record<ProjectRiskLevel, number> = {
  blocked: 0,
  watch: 1,
  normal: 2,
}

const waitingOnValues = new Set<ProjectWaitingOn>(["none", "customer", "internal", "vendor"])

export function groupProjectWorkbenchProjects<T extends ProjectWorkbenchInput>(
  projects: T[],
  now: Date = new Date(),
): ProjectWorkbenchGroups<T> {
  const nowTime = now.getTime()
  const upcomingUntil = nowTime + upcomingWindowMs
  const groups: ProjectWorkbenchGroups<T> = {
    active: [],
    risk: [],
    upcoming: [],
    waiting: [],
  }

  for (const project of projects) {
    const normalized = normalizeProjectWorkbenchProject(project)

    if (isHiddenFromWorkbench(normalized)) {
      continue
    }

    if (normalized.projectRiskLevel !== "normal") {
      groups.risk.push(normalized)
      continue
    }

    if (
      normalized.nextActionDueAtTime !== null &&
      normalized.nextActionDueAtTime <= upcomingUntil
    ) {
      groups.upcoming.push(normalized)
      continue
    }

    if (normalized.projectWaitingOn !== "none") {
      groups.waiting.push(normalized)
      continue
    }

    if (shouldShowAsActiveProject(normalized)) {
      groups.active.push(normalized)
    }
  }

  groups.risk.sort(sortRiskProjects)
  groups.upcoming.sort(sortDueProjects)
  groups.waiting.sort(sortUpdatedProjects)
  groups.active.sort(sortUpdatedProjects)

  return groups
}

export function normalizeProjectWorkbenchProject<T extends ProjectWorkbenchInput>(
  project: T,
): NormalizedProjectWorkbenchProject<T> {
  return {
    ...project,
    nextActionDueAtTime: toTime(project.nextActionDueAt),
    projectRiskLevel: normalizeRiskLevel(project.riskLevel ?? project.risk),
    projectWaitingOn: normalizeWaitingOn(project.waitingOn),
    updatedAtTime: toTime(project.updatedAt) ?? 0,
  }
}

function isHiddenFromWorkbench(project: NormalizedProjectWorkbenchProject) {
  return Boolean(project.deletedAt) || project.status === "archived"
}

function shouldShowAsActiveProject(project: NormalizedProjectWorkbenchProject) {
  if (project.stage !== "aftercare") {
    return true
  }

  return project.hasOpenAftercareTask === true
}

function sortRiskProjects(
  left: NormalizedProjectWorkbenchProject,
  right: NormalizedProjectWorkbenchProject,
) {
  const riskDiff = riskRank[left.projectRiskLevel] - riskRank[right.projectRiskLevel]

  if (riskDiff !== 0) {
    return riskDiff
  }

  return sortDueProjects(left, right)
}

function sortDueProjects(
  left: NormalizedProjectWorkbenchProject,
  right: NormalizedProjectWorkbenchProject,
) {
  const leftDue = left.nextActionDueAtTime ?? Number.POSITIVE_INFINITY
  const rightDue = right.nextActionDueAtTime ?? Number.POSITIVE_INFINITY
  const dueDiff = leftDue - rightDue

  if (dueDiff !== 0) {
    return dueDiff
  }

  return sortUpdatedProjects(left, right)
}

function sortUpdatedProjects(
  left: NormalizedProjectWorkbenchProject,
  right: NormalizedProjectWorkbenchProject,
) {
  return right.updatedAtTime - left.updatedAtTime
}

function normalizeRiskLevel(value: ProjectRiskLevel | null | undefined): ProjectRiskLevel {
  if (value === "blocked" || value === "watch") {
    return value
  }

  return "normal"
}

function normalizeWaitingOn(value: ProjectWorkbenchInput["waitingOn"]): ProjectWaitingOn {
  if (typeof value === "string" && waitingOnValues.has(value as ProjectWaitingOn)) {
    return value as ProjectWaitingOn
  }

  return "none"
}

function toTime(value: Date | null | string | undefined) {
  if (!value) {
    return null
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()

  return Number.isFinite(time) ? time : null
}
