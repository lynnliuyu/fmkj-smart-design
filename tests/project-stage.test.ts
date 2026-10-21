import { describe, expect, it } from "vitest"

import { resolveProjectStage } from "../lib/project-stage.js"

describe("resolveProjectStage", () => {
  it("keeps a new project in new follow-up when no business facts exist", () => {
    expect(resolveProjectStage({})).toMatchObject({
      stage: "new",
      statusLabel: "新建跟进",
    })
  })

  it("moves to proposal when a quote exists even without a point map", () => {
    expect(resolveProjectStage({ hasQuote: true })).toMatchObject({
      stage: "proposal",
      statusLabel: "报价中",
    })
  })

  it("uses point map or product selection as proposal preparation", () => {
    expect(resolveProjectStage({ hasPointMap: true })).toMatchObject({
      stage: "proposal",
      statusLabel: "方案准备中",
    })
    expect(resolveProjectStage({ hasProductSelection: true })).toMatchObject({
      stage: "proposal",
      statusLabel: "方案准备中",
    })
  })

  it("moves signed contract facts ahead of quote facts", () => {
    expect(resolveProjectStage({ hasContract: true, hasQuote: true })).toMatchObject({
      stage: "contract",
      statusLabel: "待开工",
    })
  })

  it("moves accepted delivery projects to aftercare", () => {
    expect(
      resolveProjectStage({
        hasAcceptedDelivery: true,
      }),
    ).toMatchObject({
      stage: "aftercare",
      statusLabel: "已交付",
    })
  })
})
