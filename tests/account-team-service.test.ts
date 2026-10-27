import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildAccountContext } from "../lib/account-context"
import type { AuthUser } from "../lib/auth"

type Row = Record<string, unknown>
type QueryResult = { rows: Row[]; rowCount: number | null }

const db = vi.hoisted(() => {
  const state = {
    memberCount: 0,
    queries: [] as string[],
    planCode: "ENTERPRISE_MONTHLY" as "ENTERPRISE_MONTHLY" | "ENTERPRISE_CUSTOM",
    organizationExists: true,
    profileType: "SUPER_ADMIN" as "SUPER_ADMIN" | "ENTERPRISE_OWNER",
    existingUser: false,
    failOn: null as string | null,
    transaction: { begin: 0, commit: 0, rollback: 0 },
  }

  function answer(sql: string, params?: unknown[]): QueryResult {
    const text = sql.replace(/\s+/g, " ").trim().toLowerCase()
    state.queries.push(text)
    if (state.failOn && text.startsWith(state.failOn)) throw new Error(`synthetic failure: ${state.failOn}`)
    if (text === "begin") state.transaction.begin++
    if (text === "commit") state.transaction.commit++
    if (text === "rollback") state.transaction.rollback++

    if (text.startsWith("select id::text, code::text as code, name from organization_roles")) {
      return { rows: [{ id: "role_editor", code: "editor", name: "销售" }], rowCount: 1 }
    }
    if (text.startsWith("select id::text from users where lower(email)")) {
      return state.existingUser ? { rows: [{ id: "existing_user" }], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.startsWith("select id::text, name, owner_user_id")) {
      return state.organizationExists
        ? { rows: [{ id: "org_1", name: "测试团队", ownerUserId: "user_1" }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (text.startsWith("insert into users")) {
      return { rows: [{ id: "new_user" }], rowCount: 1 }
    }
    if (text.startsWith("insert into organizations")) {
      state.organizationExists = true
      return { rows: [{ id: "org_1", name: "测试团队", ownerUserId: "user_1" }], rowCount: 1 }
    }
    if (text.startsWith("update account_profiles")) {
      if (text.includes("account_type = 'enterprise_owner'")) state.profileType = "ENTERPRISE_OWNER"
      return { rows: [], rowCount: 1 }
    }
    if (text.startsWith("insert into organization_roles")) {
      return { rows: [{ id: `role_${String(params?.[0] ?? "x")}` }], rowCount: 1 }
    }
    if (text.startsWith("insert into organization_role_permissions")) {
      return { rows: [], rowCount: 1 }
    }
    if (text.startsWith("select id::text, plan_id::text")) {
      return { rows: [{ id: "sub_1", planId: "plan_ent" }], rowCount: 1 }
    }
    if (text.startsWith("select id::text, plan_code")) {
      return {
        rows: [
          {
            id: "plan_ent",
            planCode: state.planCode,
            name: "企业版",
            billingCycle: "monthly",
            priceCents: 19900,
            currency: "CNY",
            limits: {},
            isActive: true,
            sortOrder: 1,
          },
        ],
        rowCount: 1,
      }
    }
    if (text.includes("count(*)::text as count")) {
      return { rows: [{ count: String(state.memberCount) }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }

  return {
    state,
    pool: {
      query: async (sql: string, params?: unknown[]) => answer(sql, params),
      connect: async () => ({ query: async (sql: string, params?: unknown[]) => answer(sql, params), release: () => {} }),
    },
    reset() {
      state.memberCount = 0
      state.queries = []
      state.planCode = "ENTERPRISE_MONTHLY"
      state.organizationExists = true
      state.profileType = "SUPER_ADMIN"
      state.existingUser = false
      state.failOn = null
      state.transaction = { begin: 0, commit: 0, rollback: 0 }
    },
  }
})

vi.mock("@/lib/server-db", () => ({ getPool: () => db.pool, hasDatabaseUrl: () => true }))

import { AccountTeamError, createTeamMember, getAccountTeam } from "../lib/account-team-service"
import { projectVisibilityWhere } from "../lib/project-access"

const owner: AuthUser = {
  email: "owner@example.com",
  name: "老板",
  phone: null,
  role: "manager",
  userId: "user_1",
}

const enterpriseContext = () =>
  buildAccountContext(
    owner,
    {
      account_status: "active",
      account_type: "ENTERPRISE_OWNER",
      id: "user_1",
      plan_code: "ENTERPRISE_MONTHLY",
      plan_limits: { canCreateTeam: true, maxMembers: 20 },
      role: "manager",
      status: "active",
      subscription_status: "active",
    },
    { id: "org_1", name: "测试团队", role: "管理员" },
  )

beforeEach(() => {
  db.reset()
})

describe("team initialization", () => {
  it("preserves super admin identity and project visibility when first creating its team", async () => {
    db.state.organizationExists = false
    const admin = { ...owner, role: "admin" }
    const team = await getAccountTeam(buildAccountContext(admin, {
      id: admin.userId,
      role: "admin",
      account_type: db.state.profileType,
      account_status: "active",
    }))

    expect(team.organization?.id).toBe("org_1")
    const after = buildAccountContext(admin, {
      id: admin.userId,
      role: "admin",
      account_type: db.state.profileType,
      account_status: "active",
    })
    expect(after.account.isSuperAdmin).toBe(true)
    expect(projectVisibilityWhere(after).where).toBe("true")
  })
})

describe("team member creation", () => {
  it("refuses a new member once the plan member cap is reached", async () => {
    db.state.memberCount = 20

    await expect(
      createTeamMember({
        context: enterpriseContext(),
        email: "new@example.com",
        roleCode: "editor",
      }),
    ).rejects.toMatchObject({ code: "MEMBER_LIMIT_REACHED", status: 403 })
  })

  it("counts only active and invited members before rejecting", async () => {
    db.state.memberCount = 20

    await expect(
      createTeamMember({
        context: enterpriseContext(),
        email: "new@example.com",
        roleCode: "editor",
      }),
    ).rejects.toBeInstanceOf(AccountTeamError)

    const countQuery = db.state.queries.find((sql) =>
      sql.includes("count(*)::text as count"),
    )
    expect(countQuery).toContain("member_status in ('active', 'invited')")
  })

  it("lets the same request through when the plan has no member cap", async () => {
    db.state.memberCount = 20
    db.state.planCode = "ENTERPRISE_CUSTOM"

    // Reaching the email check proves the member cap did not reject the call.
    await expect(
      createTeamMember({
        context: enterpriseContext(),
        email: "not-an-email",
        roleCode: "editor",
      }),
    ).rejects.toMatchObject({ code: "VALID_EMAIL_REQUIRED", status: 400 })
  })

  it("reuses a manager's associated organization without creating or moving one", async () => {
    const manager = buildAccountContext(
      { ...owner, role: "member" },
      {
        account_status: "active",
        account_type: "ENTERPRISE_MEMBER",
        id: "user_1",
        plan_code: "ENTERPRISE_MONTHLY",
        plan_limits: { canCreateTeam: true, maxMembers: 20 },
        role: "member",
        status: "active",
        subscription_status: "active",
      },
      { id: "org_1", name: "测试团队", role: "admin" },
    )
    manager.permissions = [...manager.permissions, "enterprise.manage_members"]

    const team = await getAccountTeam(manager)

    expect(team.organization?.id).toBe("org_1")
    expect(db.state.queries.some((sql) => sql.startsWith("insert into organizations"))).toBe(false)
    expect(db.state.queries.some((sql) => sql.startsWith("update account_profiles"))).toBe(false)
  })

  it("commits a new member user, membership and profile together", async () => {
    await expect(
      createTeamMember({ context: enterpriseContext(), email: "new@example.com", roleCode: "editor" }),
    ).resolves.toBeDefined()

    expect(db.state.transaction).toEqual({ begin: 1, commit: 1, rollback: 0 })
    expect(db.state.queries.some((sql) => sql.startsWith("insert into users"))).toBe(true)
    expect(db.state.queries.some((sql) => sql.startsWith("insert into organization_members"))).toBe(true)
    expect(db.state.queries.some((sql) => sql.startsWith("insert into account_profiles"))).toBe(true)
  })

  it("rolls back all member writes when the profile insert fails", async () => {
    db.state.failOn = "insert into account_profiles"

    await expect(
      createTeamMember({ context: enterpriseContext(), email: "rollback@example.com", roleCode: "editor" }),
    ).rejects.toThrow("synthetic failure")

    expect(db.state.transaction).toEqual({ begin: 1, commit: 0, rollback: 1 })
  })

  it("rejects an existing global account without converting its profile", async () => {
    db.state.existingUser = true

    await expect(
      createTeamMember({
        context: enterpriseContext(),
        email: "existing@example.com",
        roleCode: "editor",
      }),
    ).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS", status: 409 })

    expect(db.state.queries.some((sql) => sql.includes("insert into account_profiles"))).toBe(false)
    expect(db.state.queries.some((sql) => sql.includes("insert into organization_members"))).toBe(false)
  })

  it("rejects a blank email before touching the roster", async () => {
    db.state.memberCount = 1

    await expect(
      createTeamMember({
        context: enterpriseContext(),
        email: "   ",
        roleCode: "editor",
      }),
    ).rejects.toMatchObject({ code: "VALID_EMAIL_REQUIRED" })

    expect(db.state.queries.some((sql) => sql.includes("from users"))).toBe(false)
  })
})
