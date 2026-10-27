import { describe, expect, it, vi } from "vitest"

import {
  checkLoginAllowed,
  checkSendCodeAllowed,
  clearLoginFailures,
  clientAddress,
  LOGIN_TARGET_LIMIT,
  pruneLoginAttempts,
  recordLoginFailure,
} from "../lib/login-guard"

/** 用内存表假装数据库，能真实累计次数。 */
function fakeDb(rows: Array<{ key: string; occurred_at?: string; created_at?: string; target?: string }> = []) {
  return {
    rows,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("delete from login_attempts where key = any")) {
        const keys = params[0] as string[]
        rows.splice(0, rows.length, ...rows.filter((row) => !keys.includes(row.key)))
        return { rows: [] }
      }
      if (sql.includes("delete from login_attempts where occurred_at")) {
        rows.splice(0, rows.length, ...rows.filter((row) => row.key === "keep"))
        return { rows: [] }
      }
      if (sql.includes("insert into login_attempts")) {
        rows.push({ key: params[0] as string })
        return { rows: [] }
      }
      // 计数：key 维度 与 lower(target) 维度共用一段实现
      const key = params[0] as string
      const matched = rows.filter((row) => (sql.includes("lower(target)") ? row.target === key : row.key === key))
      return { rows: [{ count: matched.length, oldest_age: matched.length ? 10 : 0 }] }
    }),
  }
}

describe("来源识别", () => {
  it("有反向代理时取第一个来源，取不到就返回空（不做来源维度的封禁）", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4")
    expect(clientAddress(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9")
    expect(clientAddress(new Headers())).toBe("")
  })
})

describe("登录失败次数闸门", () => {
  it("失败次数没到上限就放行", async () => {
    const db = fakeDb()
    await recordLoginFailure("A@Example.com", "", { db })
    expect(await checkLoginAllowed("a@example.com", "", { db })).toMatchObject({ allowed: true, used: 1 })
  })

  it("同一个账号失败到上限就拦住，并告诉要等多久", async () => {
    const db = fakeDb()
    for (let index = 0; index < LOGIN_TARGET_LIMIT.limit; index += 1) {
      await recordLoginFailure("a@example.com", "", { db })
    }
    const status = await checkLoginAllowed("a@example.com", "", { db })
    expect(status.allowed).toBe(false)
    expect(status.used).toBe(LOGIN_TARGET_LIMIT.limit)
    expect(status.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("大小写与空格不影响计数：换个写法照样算同一个账号", async () => {
    const db = fakeDb()
    for (let index = 0; index < LOGIN_TARGET_LIMIT.limit; index += 1) {
      await recordLoginFailure("a@example.com", "", { db })
    }
    expect(await checkLoginAllowed("  A@EXAMPLE.COM ", "", { db })).toMatchObject({ allowed: false })
  })

  it("登录成功即清零，之前输错过不影响以后", async () => {
    const db = fakeDb()
    for (let index = 0; index < LOGIN_TARGET_LIMIT.limit; index += 1) {
      await recordLoginFailure("a@example.com", "1.2.3.4", { db })
    }
    expect(await checkLoginAllowed("a@example.com", "1.2.3.4", { db })).toMatchObject({ allowed: false })

    await clearLoginFailures("a@example.com", "1.2.3.4", { db })
    expect(await checkLoginAllowed("a@example.com", "1.2.3.4", { db })).toMatchObject({ allowed: true, used: 0 })
  })

  it("来源维度单独计数：换账号也躲不过同一个来源的限制", async () => {
    const db = fakeDb()
    // 每个账号只失败 1 次（远低于账号上限），但都来自同一个来源
    for (let index = 0; index < 40; index += 1) {
      await recordLoginFailure(`user${index}@example.com`, "1.2.3.4", { db })
    }
    expect(await checkLoginAllowed("brand-new@example.com", "1.2.3.4", { db })).toMatchObject({ allowed: false })
    // 没有来源信息时不启用这一层，避免设备上没有反代时把所有人一起锁住
    expect(await checkLoginAllowed("brand-new@example.com", "", { db })).toMatchObject({ allowed: true })
  })

  it("清理一天前的记录", async () => {
    const db = fakeDb([{ key: "old" }, { key: "keep" }])
    await pruneLoginAttempts({ db })
    expect(db.rows.map((row) => row.key)).toEqual(["keep"])
  })
})

describe("发验证码闸门", () => {
  it("一小时最多 5 条，用已发的验证码记录来数", async () => {
    const db = fakeDb([{ key: "x", target: "a@example.com" }, { key: "x", target: "a@example.com" }])
    expect(await checkSendCodeAllowed("A@example.com", { db })).toMatchObject({ allowed: true, used: 2 })

    for (let index = 0; index < 3; index += 1) db.rows.push({ key: "x", target: "a@example.com" })
    const status = await checkSendCodeAllowed("a@example.com", { db })
    expect(status.allowed).toBe(false)
    expect(status.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("不同目标互不影响", async () => {
    const db = fakeDb()
    for (let index = 0; index < 5; index += 1) db.rows.push({ key: "x", target: "a@example.com" })
    expect(await checkSendCodeAllowed("a@example.com", { db })).toMatchObject({ allowed: false })
    expect(await checkSendCodeAllowed("b@example.com", { db })).toMatchObject({ allowed: true, used: 0 })
  })
})
