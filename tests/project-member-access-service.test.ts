import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("@/lib/server-db", () => ({ getPool: () => db, hasDatabaseUrl: () => true }))

import { buildAccountContext } from "../lib/account-context"
import { getProjectAccessList, setProjectMemberAccess } from "../lib/project-member-access-service"

const USER = "11111111-1111-4111-8111-111111111111"
const MEMBER = "22222222-2222-4222-8222-222222222222"
const ORG = "33333333-3333-4333-8333-333333333333"
const PROJECT = "44444444-4444-4444-8444-444444444444"
const user = { userId: USER, name: "虚构管理员", role: "admin", email: "synthetic@example.invalid" }
const organization = { id: ORG, name: "虚构企业", role: "owner" }
const project = { id: PROJECT, ownerType: "organization", ownerId: ORG, createdBy: USER }
const owner = (subscriptionStatus: "active" | "expired" | "grace_period" = "active") => buildAccountContext(user, {
  id: USER, account_type: "ENTERPRISE_OWNER", account_status: "active", role: "member", status: "active", subscription_status: subscriptionStatus,
}, organization)
const assign = (context: ReturnType<typeof buildAccountContext>) => setProjectMemberAccess({ context, projectId: PROJECT, userId: MEMBER, granted: true, accessLevel: "edit" })

beforeEach(() => {
  db.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("from projects p")) return { rows: [project], rowCount: 1 }
    if (sql.includes("select id::text") && sql.includes("from organization_members")) return { rows: [{ id: MEMBER }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
})

describe("项目成员授权同样受账号状态与写权限约束", () => {
  it("停用超管不能读取成员名单，也不能利用原有超管标记写授权", async () => {
    const disabled = buildAccountContext(user, { id: USER, account_type: "SUPER_ADMIN", account_status: "disabled", role: "admin", status: "active" })
    expect(disabled.account.isSuperAdmin).toBe(true)
    expect(disabled.permissions).toEqual([])
    await expect(getProjectAccessList(disabled, PROJECT)).rejects.toMatchObject({ code: "ACCOUNT_DISABLED", status: 403 })
    await expect(assign(disabled)).rejects.toMatchObject({ code: "ACCOUNT_DISABLED", status: 403 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it.each(["expired", "grace_period"] as const)("%s 企业主可以读已有成员名单，但不能改授权", async (status) => {
    const context = owner(status)
    expect(await getProjectAccessList(context, PROJECT)).toMatchObject({ canManage: false, projectId: PROJECT })
    db.query.mockClear()
    await expect(assign(context)).rejects.toMatchObject({ code: "SUBSCRIPTION_EXPIRED", status: 403 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("没有查看项目权限的账号不能读取成员名单", async () => {
    const context = owner()
    context.permissions = ["project.edit"]
    await expect(getProjectAccessList(context, PROJECT)).rejects.toMatchObject({ code: "ROLE_PERMISSION_DENIED", status: 403 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("正常企业主仍可授权成员，不把新增检查变成全员禁用", async () => {
    expect(await assign(owner())).toMatchObject({ canManage: true, projectId: PROJECT })
    const writes = db.query.mock.calls.filter(([sql]) => sql.includes("insert into project_members"))
    expect(writes).toHaveLength(1)
    expect(writes[0][1]).toEqual([PROJECT, MEMBER, "edit"])
  })
})
