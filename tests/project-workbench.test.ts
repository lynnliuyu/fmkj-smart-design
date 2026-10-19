import { describe, expect, it } from "vitest"

import { groupProjectWorkbenchProjects } from "../lib/project-workbench.js"
import type { ProjectWorkbenchInput } from "../lib/project-workbench.js"

const now = new Date("2026-06-30T00:00:00.000Z")

function project(input: Partial<ProjectWorkbenchInput> & { id: string }): ProjectWorkbenchInput {
  return {
    stage: "proposal",
    status: "active",
    updatedAt: "2026-06-29T00:00:00.000Z",
    waitingOn: "none",
    ...input,
  }
}

describe("project workbench grouping", () => {
  it("puts risk projects first and keeps risk ahead of due or waiting state", () => {
    const groups = groupProjectWorkbenchProjects(
      [
        project({
          id: "watch_waiting",
          riskLevel: "watch",
          waitingOn: "customer",
        }),
        project({
          id: "blocked_later",
          nextActionDueAt: "2026-07-03T00:00:00.000Z",
          riskLevel: "blocked",
        }),
        project({
          id: "blocked_soon",
          nextActionDueAt: "2026-06-30T08:00:00.000Z",
          riskLevel: "blocked",
        }),
      ],
      now,
    )

    expect(groups.risk.map((item) => item.id)).toEqual([
      "blocked_soon",
      "blocked_later",
      "watch_waiting",
    ])
    expect(groups.waiting).toHaveLength(0)
  })

  it("groups projects due within three days before waiting projects", () => {
    const groups = groupProjectWorkbenchProjects(
      [
        project({
          id: "waiting_customer",
          waitingOn: "customer",
        }),
        project({
          id: "due_soon_and_waiting",
          nextActionDueAt: "2026-07-02T00:00:00.000Z",
          waitingOn: "internal",
        }),
        project({
          id: "overdue",
          nextActionDueAt: "2026-06-29T00:00:00.000Z",
        }),
        project({
          id: "future",
          nextActionDueAt: "2026-07-05T00:00:00.000Z",
        }),
      ],
      now,
    )

    expect(groups.upcoming.map((item) => item.id)).toEqual(["overdue", "due_soon_and_waiting"])
    expect(groups.waiting.map((item) => item.id)).toEqual(["waiting_customer"])
    expect(groups.active.map((item) => item.id)).toEqual(["future"])
  })

  it("excludes archived, deleted, and quiet aftercare projects from the default workbench", () => {
    const groups = groupProjectWorkbenchProjects(
      [
        project({ id: "archived", status: "archived" }),
        project({ deletedAt: "2026-06-29T00:00:00.000Z", id: "deleted" }),
        project({ id: "aftercare_quiet", stage: "aftercare" }),
        project({
          hasOpenAftercareTask: true,
          id: "aftercare_open",
          stage: "aftercare",
        }),
        project({
          id: "aftercare_blocked",
          riskLevel: "blocked",
          stage: "aftercare",
        }),
      ],
      now,
    )

    expect(groups.risk.map((item) => item.id)).toEqual(["aftercare_blocked"])
    expect(groups.active.map((item) => item.id)).toEqual(["aftercare_open"])
    expect([
      ...groups.risk,
      ...groups.upcoming,
      ...groups.waiting,
      ...groups.active,
    ].map((item) => item.id)).not.toContain("aftercare_quiet")
  })
})
