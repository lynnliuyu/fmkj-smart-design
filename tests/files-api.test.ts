import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ context: vi.fn(), query: vi.fn(), read: vi.fn() }))
vi.mock("@/lib/server-db", () => ({ getPool: () => ({ query: mocks.query }), hasDatabaseUrl: () => true }))
vi.mock("@/lib/account-context", async (original) => ({ ...await original<typeof import("../lib/account-context")>(), getCurrentAccountContext: mocks.context }))
vi.mock("@/lib/file-storage", async (original) => ({ ...await original<typeof import("../lib/file-storage")>(), readLocalFile: mocks.read }))

import { buildAccountContext } from "../lib/account-context"
import { GET } from "../app/api/files/[...path]/route"

const USER = "11111111-1111-4111-8111-111111111111"
const PROJECT = "44444444-4444-4444-8444-444444444444"
const user = { userId: USER, name: "虚构用户", role: "designer" }
const routeContext = { params: Promise.resolve({ path: ["contracts", PROJECT, "synthetic.pdf"] }) }
const request = new Request("http://localhost/api/files/contracts/synthetic.pdf")

beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue(buildAccountContext(user))
  mocks.query.mockReset().mockImplementation(async (sql: string) => sql.includes("project_attachments")
    ? { rows: [{ projectId: PROJECT }], rowCount: 1 }
    : { rows: [{ exists: true }], rowCount: 1 })
  mocks.read.mockReset().mockResolvedValue({ bytes: Buffer.from("synthetic PDF"), contentType: "application/pdf" })
})

describe("本地附件读取拒绝停用账号，保留到期只读", () => {
  it("停用账号的旧会话不能继续下载合同", async () => {
    mocks.context.mockResolvedValue(buildAccountContext(user, { id: USER, role: "admin", status: "inactive" }))
    expect((await GET(request, routeContext)).status).toBe(403)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it("到期账号仍能读取归自己项目的已有文件", async () => {
    mocks.context.mockResolvedValue(buildAccountContext(user, { id: USER, account_type: "PERSONAL_PRO", role: "designer", status: "active", subscription_status: "expired" }))
    const response = await GET(request, routeContext)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("synthetic PDF")
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.query.mock.calls[1][1]).toEqual([PROJECT, USER])
  })

  it("缺少查看项目权限时不能仅凭合同路径下载", async () => {
    const context = buildAccountContext(user)
    context.permissions = []
    mocks.context.mockResolvedValue(context)
    expect((await GET(request, routeContext)).status).toBe(404)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })
})
