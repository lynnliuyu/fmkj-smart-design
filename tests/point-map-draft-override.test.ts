import { describe, expect, it, vi } from "vitest"
import { overridePointMapDraft } from "../lib/point-map-draft-override"
import { normalizeDesignPlan } from "../lib/point-map-design"
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan"

const projectId = "project-a"
const cloud = (patch: Partial<PointMapPlan> = {}): PointMapPlan =>
  normalizeDesignPlan({ ...emptyPointMapPlan(projectId), floorplanName: "cloud.png", ...patch })
const local = (patch: Partial<PointMapPlan> = {}): PointMapPlan =>
  normalizeDesignPlan({ ...emptyPointMapPlan(projectId), floorplanName: "local.png", ...patch })

function dependencies(overrides: {
  cloudPlan?: PointMapPlan | null
  cloudRevision?: number
  backupFails?: boolean
  saveFails?: boolean
} = {}) {
  const calls: string[] = []
  const save = vi.fn(async (plan: PointMapPlan, expectedRevision: number) => {
    calls.push(`save:r${expectedRevision}`)
    if (overrides.saveFails) throw Object.assign(new Error("POINT_MAP_REVISION_CONFLICT"), { status: 409 })
    return {
      plan: { ...plan, floors: plan.floors?.map((floor) => ({ ...floor, floorplanName: "server.png" })) },
      revision: expectedRevision + 1,
    }
  })
  const backup = vi.fn(async (plan: PointMapPlan) => {
    calls.push(`backup:${plan.floorplanName}`)
    if (overrides.backupFails) throw new Error("QuotaExceededError")
  })
  return {
    calls,
    save,
    backup,
    deps: {
      read: async () => {
        calls.push("read")
        return { plan: overrides.cloudPlan === undefined ? cloud() : overrides.cloudPlan, revision: overrides.cloudRevision ?? 4 }
      },
      backup,
      save,
      normalize: normalizeDesignPlan,
    },
  }
}

describe("explicit point-map override", () => {
  it("bases the write on the freshly read cloud revision instead of a stale one", async () => {
    const { deps, save, calls } = dependencies({ cloudRevision: 7 })
    await overridePointMapDraft(deps, local())
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][1]).toBe(7)
    // 先读回云端、再备份、最后才写，避免在没有可回退备份的情况下覆盖。
    expect(calls).toEqual(["read", "backup:cloud.png", "save:r7"])
  })

  it("backs up the cloud draft that is being replaced, not the local one", async () => {
    const replaced = cloud({ floorplanName: "被替换.png" })
    const { deps, backup } = dependencies({ cloudPlan: replaced })
    await overridePointMapDraft(deps, local())
    expect(backup).toHaveBeenCalledOnce()
    expect((backup.mock.calls[0][0] as PointMapPlan).floorplanName).toBe("被替换.png")
  })

  it("still saves when the backup cannot be written, and reports that it was not stored", async () => {
    const { deps } = dependencies({ backupFails: true })
    const outcome = await overridePointMapDraft(deps, local())
    expect(outcome.backupStored).toBe(false)
    expect(outcome.revision).toBe(5)
  })

  it("adapts the server draft and reports the replaced revision", async () => {
    const { deps } = dependencies({ cloudRevision: 4 })
    const outcome = await overridePointMapDraft(deps, local())
    expect(outcome).toMatchObject({ revision: 5, replacedRevision: 4, replaced: true, backupStored: true })
    expect(outcome.plan.floorplanName).toBe("server.png")
  })

  it("creates the first cloud draft without inventing a backup when the cloud has none", async () => {
    const { deps, backup, save } = dependencies({ cloudPlan: null, cloudRevision: 0 })
    const outcome = await overridePointMapDraft(deps, local())
    expect(backup).not.toHaveBeenCalled()
    expect(save.mock.calls[0][1]).toBe(0)
    expect(outcome).toMatchObject({ replaced: false, replacedRevision: 0, backupStored: false })
  })

  it("surfaces a second concurrent cloud change instead of overwriting it", async () => {
    const { deps } = dependencies({ saveFails: true })
    await expect(overridePointMapDraft(deps, local())).rejects.toThrow("POINT_MAP_REVISION_CONFLICT")
  })
})
