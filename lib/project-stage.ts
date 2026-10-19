import type { ProjectStage } from "./project-workflow"

export type ProjectStageFacts = {
  hasAcceptedDelivery?: boolean
  hasContract?: boolean
  hasPointMap?: boolean
  hasProductSelection?: boolean
  hasQuote?: boolean
  projectStatus?: string | null
  workOrders?: Array<{
    /** 工单状态由运维侧写入，这里是开放字符串，未知值按"安装调试"处理。 */
    status: string
  }>
}

export type ProjectStageResolution = {
  stage: ProjectStage
  statusLabel: string
}

const inactiveWorkOrderStatuses = new Set(["canceled", "voided", "deleted"])
const doneWorkOrderStatuses = new Set(["done", "completed"])

export function resolveProjectStage(facts: ProjectStageFacts): ProjectStageResolution {
  if (facts.projectStatus === "canceled") {
    return { stage: "new", statusLabel: "已取消" }
  }

  const activeWorkOrders = (facts.workOrders ?? []).filter(
    (workOrder) => !inactiveWorkOrderStatuses.has(workOrder.status),
  )

  if (facts.hasAcceptedDelivery) {
    return { stage: "aftercare", statusLabel: "已交付" }
  }

  if (activeWorkOrders.length > 0) {
    const allDone = activeWorkOrders.every((workOrder) => doneWorkOrderStatuses.has(workOrder.status))
    return allDone
      ? { stage: "acceptance", statusLabel: "待验收" }
      : { stage: "install", statusLabel: workOrderSubStatus(activeWorkOrders[0]?.status) }
  }

  if (facts.hasContract) {
    return { stage: "contract", statusLabel: "待开工" }
  }

  if (facts.hasQuote) {
    return { stage: "proposal", statusLabel: "报价中" }
  }

  if (facts.hasPointMap || facts.hasProductSelection) {
    return { stage: "proposal", statusLabel: "方案准备中" }
  }

  return { stage: "new", statusLabel: "新建跟进" }
}

function workOrderSubStatus(status: string | undefined) {
  if (status === "pending-location") return "待定点位"
  if (status === "dispatching") return "待派工"
  if (status === "scheduled") return "待开工"
  if (status === "blocked") return "安装阻塞"
  if (status === "in-progress") return "施工中"
  return "安装调试"
}
