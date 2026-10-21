import type { ProjectStage } from "./project-workflow"

export type ProjectStageFacts = {
  hasAcceptedDelivery?: boolean
  hasContract?: boolean
  hasPointMap?: boolean
  hasProductSelection?: boolean
  hasQuote?: boolean
  projectStatus?: string | null
}

export type ProjectStageResolution = {
  stage: ProjectStage
  statusLabel: string
}

export function resolveProjectStage(facts: ProjectStageFacts): ProjectStageResolution {
  if (facts.projectStatus === "canceled") {
    return { stage: "new", statusLabel: "已取消" }
  }

  if (facts.hasAcceptedDelivery) {
    return { stage: "aftercare", statusLabel: "已交付" }
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
