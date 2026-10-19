import { describe, expect, it } from "vitest"

import { buildAccountContext, type AccountContext } from "../lib/account-context"
import type { PointMapPlan } from "../lib/point-map-plan"
import { getProjectPointMap, saveProjectPointMap } from "../lib/point-map-service"

const PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const USER_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333"
const ORGANIZATION_ID = "44444444-4444-4444-8444-444444444444"
const NOW = new Date("2026-10-14T02:00:00.000Z")
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

type StoredPlan = { plan: PointMapPlan; revision: number }
type StoredVersion = StoredPlan & { confirmedAt: Date }
type QueryCall = { sql: string; params: unknown[] }

class MemoryPointMapClient {
  calls: QueryCall[] = []
  released = false
  draft: StoredPlan | null = null
  versions: StoredVersion[] = []
  private backup: { draft: StoredPlan | null; versions: StoredVersion[] } | null = null

  constructor(readonly options: {
    visible?: boolean
    createdBy?: string
    accessLevel?: string | null
    failConfirmation?: boolean
  } = {}) {}

  async query<T>(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params })
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase()
    let rows: unknown[] = []
    if (normalized.startsWith("begin")) {
      this.backup = structuredClone({ draft: this.draft, versions: this.versions })
    } else if (normalized === "commit") {
      this.backup = null
    } else if (normalized === "rollback") {
      if (this.backup) Object.assign(this, this.backup)
      this.backup = null
    } else if (normalized.includes("from projects p")) {
      rows = this.options.visible === false ? [] : [{
        createdBy: this.options.createdBy ?? USER_ID,
        accessLevel: this.options.accessLevel ?? null,
      }]
    } else if (normalized.startsWith("select revision, plan from project_point_map_designs")) {
      rows = this.draft ? [structuredClone(this.draft)] : []
    } else if (normalized.startsWith("insert into project_point_map_designs")) {
      this.draft = { plan: JSON.parse(params[1] as string), revision: params[2] as number }
    } else if (normalized.startsWith("update project_point_map_designs")) {
      if (this.draft?.revision === params[4]) {
        this.draft = { plan: JSON.parse(params[1] as string), revision: params[2] as number }
        rows = [{ revision: this.draft.revision }]
      }
    } else if (normalized.startsWith("insert into project_point_map_versions")) {
      if (this.options.failConfirmation) throw new Error("private database diagnostics")
      this.versions.push({ plan: JSON.parse(params[2] as string), revision: params[1] as number, confirmedAt: NOW })
    } else if (normalized.startsWith("select plan, revision from project_point_map_designs")) {
      rows = this.draft ? [structuredClone(this.draft)] : []
    } else if (normalized.startsWith("select plan, revision from project_point_map_versions")) {
      rows = this.versions.filter((version) => version.revision === params[1]).map((version) => structuredClone(version))
    } else if (normalized.startsWith("select revision, confirmed_at")) {
      rows = this.versions.toSorted((a, b) => b.revision - a.revision).map(({ revision, confirmedAt }) => ({ revision, confirmedAt }))
    } else {
      throw new Error(`Unexpected test query: ${normalized}`)
    }
    return { rows: rows as T[], rowCount: rows.length }
  }

  release() { this.released = true }
}

function database(client: MemoryPointMapClient) {
  return { connect: async () => client } as never
}

function account(type: "PERSONAL_PRO" | "PERSONAL_FREE" | "ENTERPRISE_MEMBER" = "PERSONAL_PRO") {
  return buildAccountContext(
    { userId: USER_ID, name: "Synthetic user", role: "pro" },
    { id: USER_ID, account_type: type, account_status: "active", role: "pro" },
    type === "ENTERPRISE_MEMBER" ? { id: ORGANIZATION_ID, name: "Synthetic team", role: "editor" } : null,
  )
}

function plan(x = 20): PointMapPlan {
  return {
    projectId: PROJECT_ID,
    schemaVersion: 2,
    floorplanName: "synthetic.png",
    floorplanDataUrl: "",
    activeFloorId: "floor-1",
    floors: [{ id: "floor-1", name: "一楼", floorplanName: "synthetic.png", floorplanDataUrl: "", imageWidth: 800, imageHeight: 600 }],
    points: [{ id: "point-1", code: "1F-K01", name: "Synthetic switch", room: "客厅", floorId: "floor-1", iconId: "switch-1", status: "planned", x, y: 30, placed: true, productId: "", note: "", source: "analysis", confidence: "low", reviewReason: "需核对控制关系" }],
    scenes: [{ id: "scene-1", name: "回家", trigger: "入口按键", description: "建议", pointIds: ["point-1"], status: "proposed" }],
    updatedAt: "2026-10-14T00:00:00.000Z",
  }
}

function reviewedPlan(x = 20): PointMapPlan {
  const reviewed = plan(x)
  reviewed.floorplanDataUrl = PNG
  reviewed.floors![0].floorplanDataUrl = PNG
  reviewed.points[0].status = "confirmed"
  reviewed.scenes![0].status = "confirmed"
  return reviewed
}

describe("project point-map persistence", () => {
  it("reloads the saved project plan and assigns its server revision and timestamp", async () => {
    const client = new MemoryPointMapClient()
    const dependencies = { db: database(client), now: () => NOW }
    await expect(getProjectPointMap(account(), PROJECT_ID, undefined, dependencies)).resolves.toEqual({ data: null, revision: 0, versions: [] })

    const saved = await saveProjectPointMap(account(), PROJECT_ID, { plan: plan(), expectedRevision: 0 }, dependencies)
    expect(saved).toMatchObject({ data: { projectId: PROJECT_ID, updatedAt: NOW.toISOString(), points: [{ x: 20 }] }, revision: 1, versions: [] })
    const loaded = await getProjectPointMap(account(), PROJECT_ID, undefined, dependencies)
    expect(loaded).toEqual(saved)
    expect(client.calls.some((call) => call.sql.includes("for update of p"))).toBe(true)
    const insert = client.calls.find((call) => call.sql.includes("insert into project_point_map_designs"))!
    expect(insert.params[0]).toBe(PROJECT_ID)
    expect(insert.params[3]).toBe(USER_ID)
    expect(insert.sql).not.toContain(PROJECT_ID)
    expect(client.released).toBe(true)
  })

  it("returns a stale-write conflict without overwriting another editor's draft", async () => {
    const client = new MemoryPointMapClient()
    const dependencies = { db: database(client) }
    await saveProjectPointMap(account(), PROJECT_ID, { plan: plan(), expectedRevision: 0 }, dependencies)
    await saveProjectPointMap(account(), PROJECT_ID, { plan: plan(60), expectedRevision: 1 }, dependencies)
    const before = structuredClone(client.draft)
    const mutationsBefore = client.calls.filter((call) => /^(insert|update)/i.test(call.sql.trim())).length

    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: plan(90), expectedRevision: 1 }, dependencies)).rejects.toMatchObject({ status: 409, code: "POINT_MAP_REVISION_CONFLICT", revision: 2 })
    expect(client.draft).toEqual(before)
    expect(client.calls.filter((call) => /^(insert|update)/i.test(call.sql.trim()))).toHaveLength(mutationsBefore)
    expect(client.calls.at(-1)?.sql).toBe("rollback")
  })

  it("preserves immutable confirmed versions while later edits change the draft", async () => {
    const client = new MemoryPointMapClient()
    const dependencies = { db: database(client), now: () => NOW }
    const confirmed = await saveProjectPointMap(account(), PROJECT_ID, { plan: reviewedPlan(), expectedRevision: 0, confirm: true }, dependencies)
    expect(confirmed.versions).toEqual([{ revision: 1, confirmedAt: NOW.toISOString() }])
    expect(confirmed.data?.scenes?.[0].status).toBe("confirmed")
    expect(confirmed.data?.points[0].confidence).toBe("low")
    expect(confirmed.data?.points[0].reviewReason).toBe("需核对控制关系")
    await saveProjectPointMap(account(), PROJECT_ID, { plan: plan(75), expectedRevision: 1 }, dependencies)
    const snapshot = await getProjectPointMap(account(), PROJECT_ID, 1, dependencies)
    const draft = await getProjectPointMap(account(), PROJECT_ID, undefined, dependencies)
    expect(snapshot.data).toEqual(confirmed.data)
    expect(snapshot.revision).toBe(1)
    expect(draft.data?.points[0].x).toBe(75)
    expect(draft.revision).toBe(2)
    expect(client.calls.some((call) => /^update project_point_map_versions/i.test(call.sql.trim()))).toBe(false)
    await expect(getProjectPointMap(account(), PROJECT_ID, 2, dependencies)).rejects.toMatchObject({ status: 404, code: "POINT_MAP_VERSION_NOT_FOUND" })
  })

  it("rolls back the draft when confirmation storage fails", async () => {
    const client = new MemoryPointMapClient({ failConfirmation: true })
    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: reviewedPlan(), expectedRevision: 0, confirm: true }, { db: database(client) })).rejects.toThrow("private database diagnostics")
    expect(client.draft).toBeNull()
    expect(client.versions).toEqual([])
    expect(client.calls.at(-1)?.sql).toBe("rollback")
    expect(client.released).toBe(true)
  })

  it("rejects unauthenticated and disabled accounts before opening a database connection", async () => {
    await expect(getProjectPointMap(null, PROJECT_ID)).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" })
    const context = account()
    context.account.status = "disabled"
    await expect(saveProjectPointMap(context, PROJECT_ID, {})).rejects.toMatchObject({ status: 403, code: "ACCOUNT_DISABLED" })
  })

  it("returns 404 for another customer's project without reading or writing its designs", async () => {
    const client = new MemoryPointMapClient({ visible: false })
    const dependencies = { db: database(client) }
    const context = account("ENTERPRISE_MEMBER")
    await expect(getProjectPointMap(context, PROJECT_ID, 1, dependencies)).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" })
    await expect(saveProjectPointMap(context, PROJECT_ID, { plan: plan(), expectedRevision: 0 }, dependencies)).rejects.toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" })
    expect(client.calls.some((call) => call.sql.includes("project_point_map"))).toBe(false)
    const access = client.calls.find((call) => call.sql.includes("from projects p"))!
    expect(access.params).toEqual([PROJECT_ID, ORGANIZATION_ID, USER_ID, USER_ID])
    expect(access.sql).toContain("p.owner_id = $2::uuid")
    expect(access.sql).toContain("pm.user_id = $3::uuid")
    expect(access.sql).not.toContain(USER_ID)
  })

  it("requires point_map.use and project.edit independently", async () => {
    const freeClient = new MemoryPointMapClient()
    await expect(getProjectPointMap(account("PERSONAL_FREE"), PROJECT_ID, undefined, { db: database(freeClient) })).rejects.toMatchObject({ status: 403, code: "POINT_MAP_NOT_INCLUDED" })
    const context = account()
    context.permissions = context.permissions.filter((permission) => permission !== "project.edit")
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(context, PROJECT_ID, { plan: plan(), expectedRevision: 0 }, { db: database(client) })).rejects.toMatchObject({ status: 403, code: "ROLE_PERMISSION_DENIED" })
    expect(client.draft).toBeNull()
  })

  it("allows a visible viewer to read but refuses writes despite account edit permission", async () => {
    const client = new MemoryPointMapClient({ createdBy: OTHER_USER_ID, accessLevel: "view" })
    const context = account("ENTERPRISE_MEMBER")
    await expect(getProjectPointMap(context, PROJECT_ID, undefined, { db: database(client) })).resolves.toMatchObject({ revision: 0 })
    await expect(saveProjectPointMap(context, PROJECT_ID, { plan: plan(), expectedRevision: 0 }, { db: database(client) })).rejects.toMatchObject({ status: 403, code: "PROJECT_READ_ONLY" })
    expect(client.draft).toBeNull()
  })

  it("allows an editor's project membership to save a visible team project", async () => {
    const client = new MemoryPointMapClient({ createdBy: OTHER_USER_ID, accessLevel: "edit" })
    await expect(saveProjectPointMap(account("ENTERPRISE_MEMBER"), PROJECT_ID, { plan: plan(), expectedRevision: 0 }, { db: database(client) })).resolves.toMatchObject({ revision: 1 })
  })

  it.each(["grace_period", "expired", "past_due"] as const)("rejects writes for %s subscriptions even if a stale context carries edit permission", async (subscriptionStatus) => {
    const context: AccountContext = account()
    context.account.subscriptionStatus = subscriptionStatus
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(context, PROJECT_ID, { plan: plan(), expectedRevision: 0 }, { db: database(client) })).rejects.toMatchObject({ status: 403, code: "SUBSCRIPTION_EXPIRED" })
    expect(client.draft).toBeNull()
  })

  it("retains grace-period read access while blocking point-map use after expiry", async () => {
    const context = account()
    const client = new MemoryPointMapClient()
    context.account.subscriptionStatus = "grace_period"
    await expect(getProjectPointMap(context, PROJECT_ID, undefined, { db: database(client) })).resolves.toMatchObject({ revision: 0 })
    context.account.subscriptionStatus = "expired"
    await expect(getProjectPointMap(context, PROJECT_ID, undefined, { db: database(client) })).rejects.toMatchObject({ status: 403, code: "SUBSCRIPTION_EXPIRED" })
  })

  it.each([-1, 1.5, Number.NaN, "0", undefined])("rejects invalid expectedRevision %s without mutation", async (expectedRevision) => {
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: plan(), expectedRevision }, { db: database(client) })).rejects.toMatchObject({ status: 400, code: "INVALID_POINT_MAP_REQUEST" })
    expect(client.draft).toBeNull()
  })

  it("rejects a plan for another project and dangling scene references atomically", async () => {
    for (const invalidPlan of [
      { ...plan(), projectId: OTHER_USER_ID },
      { ...plan(), scenes: [{ ...plan().scenes![0], pointIds: ["unknown-point"] }] },
    ]) {
      const client = new MemoryPointMapClient()
      await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: invalidPlan, expectedRevision: 0 }, { db: database(client) })).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" })
      expect(client.draft).toBeNull()
    }
  })

  it("rejects confirmation of unreviewed points or scenes even when clients bypass the UI", async () => {
    const proposedScene = reviewedPlan()
    proposedScene.scenes![0].status = "proposed"
    const unplaced = reviewedPlan()
    unplaced.points[0].placed = false
    for (const unreviewed of [plan(), proposedScene, unplaced]) {
      const client = new MemoryPointMapClient()
      await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: unreviewed, expectedRevision: 0, confirm: true }, { db: database(client) })).rejects.toMatchObject({ status: 400, code: "POINT_MAP_REVIEW_REQUIRED" })
      expect(client.draft).toBeNull()
      expect(client.versions).toEqual([])
    }
  })

  it("requires a readable floor image for every placed point in a confirmed version", async () => {
    const withoutImage = reviewedPlan()
    withoutImage.floorplanDataUrl = ""
    withoutImage.floors![0].floorplanDataUrl = ""
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: withoutImage, expectedRevision: 0, confirm: true }, { db: database(client) })).rejects.toMatchObject({ status: 400, code: "POINT_MAP_FLOORPLAN_REQUIRED" })
    expect(client.draft).toBeNull()
    expect(client.versions).toEqual([])
  })

  it("limits normalized legacy plans too, preventing a stored plan that can no longer be saved", async () => {
    const largeHeader = `data:image/png;base64,iVBORw0KGgoA${"A".repeat(17 * 1024 * 1024)}`
    const legacy = { projectId: PROJECT_ID, floorplanName: "synthetic.png", floorplanDataUrl: largeHeader, points: [], updatedAt: "2026-10-14T00:00:00Z" }
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: legacy, expectedRevision: 0 }, { db: database(client) })).rejects.toMatchObject({ status: 413, code: "POINT_MAP_TOO_LARGE" })
    expect(client.draft).toBeNull()
  })

  it.each([
    { trigger: " " },
    { description: "\n" },
    { pointIds: [] },
  ])("refuses a confirmed scene with incomplete details %s", async (patch) => {
    const reviewed = reviewedPlan()
    reviewed.scenes![0] = { ...reviewed.scenes![0], ...patch }
    const client = new MemoryPointMapClient()
    await expect(saveProjectPointMap(account(), PROJECT_ID, { plan: reviewed, expectedRevision: 0, confirm: true }, { db: database(client) })).rejects.toMatchObject({ status: 400, code: "POINT_MAP_SCENE_DETAILS_REQUIRED" })
    expect(client.draft).toBeNull()
    expect(client.versions).toEqual([])
  })
})
