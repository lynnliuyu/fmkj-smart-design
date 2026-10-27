import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }))
const auth = vi.hoisted(() => ({ setSessionCookie: vi.fn(), signSessionToken: vi.fn(async () => "token") }))

vi.mock("@/lib/server-db", () => ({ getPool: () => db }))
vi.mock("@/lib/auth", () => ({
  setSessionCookie: auth.setSessionCookie,
  signSessionToken: auth.signSessionToken,
}))

import { POST, GET } from "../app/api/setup/route"
import { createFirstAdmin, FIRST_RUN_INITIALIZED_KEY, FirstRunError, getFirstRunState, validateFirstAdmin } from "../lib/first-run"

/** 假的事务客户端：按 SQL 特征给出结果，并记录调用顺序。 */
function fakeClient(overrides: { initialized?: boolean; insert?: string | null; failOn?: string } = {}) {
  const calls: string[] = []
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.replace(/\s+/g, " ").trim())
      if (overrides.failOn && sql.includes(overrides.failOn)) throw new Error("synthetic setup failure")
      if (sql.includes("as initialized")) return { rows: [{ initialized: overrides.initialized ?? false }] }
      if (sql.includes("insert into users")) return { rows: overrides.insert ? [{ id: overrides.insert }] : [] }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  db.connect.mockResolvedValue(client)
  return { calls, client }
}

beforeEach(() => {
  db.query.mockReset()
  db.connect.mockReset()
  auth.setSessionCookie.mockReset()
})

describe("首次初始化的判定", () => {
  it("从未设置、没有账号或业务资料的空库才要初始化", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: false }] })
    expect(await getFirstRunState()).toEqual({ databaseReady: true, needsSetup: true })
  })

  it("永久记录或已有账号/业务资料会关闭首次设置，不按活跃管理员数判断", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: true }] })
    expect(await getFirstRunState()).toEqual({ databaseReady: true, needsSetup: false })
    const [sql, values] = db.query.mock.calls[0]
    expect(values).toEqual([FIRST_RUN_INITIALIZED_KEY])
    expect(sql).toContain("exists (select 1 from users)")
    expect(sql).toContain("exists (select 1 from projects)")
    expect(sql).not.toContain("status = 'active'")
    expect(sql).not.toContain("role in")
  })

  it("数据库没有返回明确的空库状态时不开放首次设置", async () => {
    db.query.mockResolvedValue({ rows: [] })
    expect(await getFirstRunState()).toEqual({ databaseReady: true, needsSetup: false })
  })

  it("数据库没起来时不当成新设备（否则会让人再建一遍管理员）", async () => {
    db.query.mockRejectedValue(new Error("connection refused"))
    expect(await getFirstRunState()).toEqual({ databaseReady: false, needsSetup: false })
  })
})

describe("表单校验", () => {
  const base = { email: "a@b.com", name: "王师傅", password: "abcd1234" }

  it("正常的输入通过", () => {
    expect(validateFirstAdmin(base)).toBeNull()
  })

  it("名字、邮箱、密码不合格都会说清楚", () => {
    expect(validateFirstAdmin({ ...base, name: " " })).toMatch(/名字/)
    expect(validateFirstAdmin({ ...base, email: "not-an-email" })).toMatch(/邮箱/)
    expect(validateFirstAdmin({ ...base, password: "short1" })).toMatch(/至少 8 位/)
    expect(validateFirstAdmin({ ...base, password: "abcdefgh" })).toMatch(/字母和数字/)
  })
})

describe("创建第一个管理员", () => {
  it("全新设备：建成并补齐账号档案与订阅", async () => {
    const { calls } = fakeClient({ insert: "user-1" })
    const result = await createFirstAdmin({ email: " A@B.com ", name: " 王师傅 ", password: "abcd1234" })

    expect(result).toMatchObject({ email: "a@b.com", name: "王师傅", userId: "user-1" })
    expect(calls[0]).toBe("begin")
    expect(calls[1]).toBe("select pg_advisory_xact_lock(hashtext('fmkj-first-run-setup'))")
    expect(calls[2]).toContain("as initialized")
    expect(calls.some((sql) => sql.startsWith("insert into account_profiles"))).toBe(true)
    expect(calls.some((sql) => sql.startsWith("insert into subscriptions"))).toBe(true)
    expect(calls.some((sql) => sql.startsWith("insert into platform_settings"))).toBe(true)
    expect(calls.at(-1)).toBe("commit")
  })

  it("已有账号即使停用或降级，也不能通过匿名设置提升邮箱或新建管理员", async () => {
    const { calls } = fakeClient({ initialized: true })
    await expect(createFirstAdmin({ email: "old@b.com", name: "老账号", password: "abcd1234" })).rejects.toMatchObject({ code: "ALREADY_INITIALIZED", status: 409 })
    expect(calls.some((sql) => sql.startsWith("update users"))).toBe(false)
    expect(calls.some((sql) => sql.startsWith("insert into users"))).toBe(false)
    expect(calls.at(-1)).toBe("rollback")
  })

  it("写入前重新检查永久状态，阻止两个请求都通过页面预检后重复创建", async () => {
    const { calls, client } = fakeClient({ initialized: true })
    await expect(createFirstAdmin({ email: "a@b.com", name: "甲", password: "abcd1234" }))
      .rejects.toThrow(FirstRunError)

    expect(calls.filter((sql) => sql === "rollback")).toHaveLength(1)
    await expect(createFirstAdmin({ email: "bad", name: "甲", password: "abcd1234" })).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(client.release).toHaveBeenCalled()
  })

  it("标记保存失败会把账号创建一并回滚，不能只完成半次初始化", async () => {
    const { calls, client } = fakeClient({ insert: "user-1", failOn: "insert into platform_settings" })
    await expect(createFirstAdmin({ email: "a@b.com", name: "甲", password: "abcd1234" })).rejects.toThrow("synthetic setup failure")
    expect(calls.at(-1)).toBe("rollback")
    expect(calls).not.toContain("commit")
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe("初始化接口", () => {
  function post(body: unknown) {
    return POST(new Request("http://localhost/api/setup", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }) as never)
  }

  it("GET 告诉装机脚本这台设备要不要初始化", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: false }] })
    expect(await (await GET()).json()).toEqual({ databaseReady: true, needsSetup: true })
  })

  it("已经初始化过：拒绝（不能拿它覆盖管理员）", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: true }] })
    const response = await post({ email: "a@b.com", name: "甲", password: "abcd1234" })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("ALREADY_INITIALIZED")
  })

  it("输入不合格：400，且不碰数据库", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: false }] })
    const response = await post({ email: "a@b.com", name: "甲", password: "123" })
    expect(response.status).toBe(400)
    expect(db.connect).not.toHaveBeenCalled()
  })

  it("创建成功：直接给会话（客户不用再登录一次）", async () => {
    db.query.mockResolvedValue({ rows: [{ initialized: false }] })
    fakeClient({ insert: "user-1" })
    const response = await post({ email: "a@b.com", name: "甲", password: "abcd1234" })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ ok: true, next: "/projects" })
    expect(auth.setSessionCookie).toHaveBeenCalledWith("token")
  })

  it("数据库没起来：503，让客户稍后再试", async () => {
    db.query.mockRejectedValue(new Error("down"))
    const response = await post({ email: "a@b.com", name: "甲", password: "abcd1234" })
    expect(response.status).toBe(503)
  })
})
