import { describe, expect, it, vi } from "vitest"

type ProfileTestContext = {
  account: {
    type: string
    status: string
    isSuperAdmin: boolean
    isEnterprise: boolean
    canManageTeam: boolean
    canUsePointMap: boolean
    subscriptionStatus: string | null
  }
  permissions: string[]
  user: { userId: string; name: string; status: string; role: string; email: string; avatarUrl: string | null; phone: string | null }
  organization: { id: string; name: string; role: string } | null
  disabledFeatures: string[]
}

const state = vi.hoisted(() => ({
  context: null as ProfileTestContext | null,
  organization: { id: "org_1", name: "甲公司", avatarUrl: null as string | null } as { id: string; name: string; avatarUrl: string | null } | null,
  usersUpdated: false,
  organizationUpdated: false,
  insertedProfileType: null as string | null,
  insertedOrganization: false,
}))

vi.mock("@/lib/account-context", () => ({
  getCurrentAccountContext: vi.fn(async () => state.context),
}))

vi.mock("@/lib/server-db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim().toLowerCase()
      if (text.startsWith("alter table")) return { rows: [], rowCount: 0 }
      if (text.startsWith("select coalesce(ap.organization_id, om.organization_id, o.id)")) {
        return { rows: state.organization ? [state.organization] : [], rowCount: state.organization ? 1 : 0 }
      }
      if (text.startsWith("select coalesce(ap.organization_id, o.id)")) {
        return { rows: state.organization ? [{ id: state.organization.id }] : [], rowCount: state.organization ? 1 : 0 }
      }
      if (text.startsWith("select u.name")) {
        return {
          rows: [{ name: "用户", email: "user@example.com", phone: null, avatar_url: null, company_id: state.organization?.id ?? null, company_name: state.organization?.name ?? null, company_avatar_url: state.organization?.avatarUrl ?? null }],
          rowCount: 1,
        }
      }
      if (text.startsWith("update users")) {
        state.usersUpdated = true
        return { rows: [], rowCount: 1 }
      }
      if (text.startsWith("insert into organizations")) {
        state.insertedOrganization = true
        state.organization = { id: "org_new", name: String(params[0]), avatarUrl: null }
        return { rows: [{ id: "org_new" }], rowCount: 1 }
      }
      if (text.startsWith("insert into account_profiles")) {
        state.insertedProfileType = String(params[2])
        return { rows: [], rowCount: 1 }
      }
      if (text.startsWith("update organizations")) {
        state.organizationUpdated = true
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
  }),
}))

import { PATCH } from "../app/api/account/profile/route"

function context(overrides: { account?: Partial<ProfileTestContext["account"]>; permissions?: string[]; organization?: ProfileTestContext["organization"] } = {}): ProfileTestContext {
  return {
    account: { type: "ENTERPRISE_MEMBER", status: "active", isSuperAdmin: false, isEnterprise: true, canManageTeam: false, canUsePointMap: true, subscriptionStatus: "active", ...overrides.account },
    permissions: overrides.permissions ?? ["project.view", "project.edit"],
    user: { userId: "user_1", name: "用户", status: "active", role: "member", email: "user@example.com", avatarUrl: null, phone: null },
    organization: overrides.organization === undefined ? { id: "org_1", name: "甲公司", role: "editor" } : overrides.organization,
    disabledFeatures: [],
  }
}

function request(body: Record<string, unknown>) {
  return new Request("http://local/api/account/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

function reset() {
  state.context = context()
  state.organization = { id: "org_1", name: "甲公司", avatarUrl: null }
  state.usersUpdated = false
  state.organizationUpdated = false
  state.insertedProfileType = null
  state.insertedOrganization = false
}

describe("account profile permissions", () => {
  it("rejects a regular member changing shared company fields before updating the user", async () => {
    reset()
    const response = await PATCH(request({ name: "新名字", companyName: "乙公司" }) as never)
    expect(response.status).toBe(403)
    expect(state.usersUpdated).toBe(false)
    expect(state.organizationUpdated).toBe(false)
  })

  it("still lets a regular member save their own name with unchanged company fields", async () => {
    reset()
    const response = await PATCH(request({ name: "新名字", companyName: "甲公司", companyAvatarUrl: "" }) as never)
    expect(response.status).toBe(200)
    expect(state.usersUpdated).toBe(true)
    expect(state.organizationUpdated).toBe(false)
  })

  it("does not create an enterprise profile for a free account submitting a company name", async () => {
    reset()
    state.context = context({ account: { type: "PERSONAL_FREE", isEnterprise: false }, organization: null })
    state.organization = null
    const response = await PATCH(request({ name: "用户", companyName: "伪企业" }) as never)
    expect(response.status).toBe(403)
    expect(state.insertedOrganization).toBe(false)
    expect(state.insertedProfileType).toBeNull()
  })

  it("preserves a super admin account type when it creates a missing organization", async () => {
    reset()
    state.context = context({ account: { type: "SUPER_ADMIN", status: "active", isSuperAdmin: true, isEnterprise: false, canManageTeam: true, canUsePointMap: true, subscriptionStatus: "active" }, permissions: ["account.manage_all", "enterprise.manage_members"] })
    state.organization = null
    const response = await PATCH(request({ name: "平台管理员", companyName: "平台公司" }) as never)
    expect(response.status).toBe(200)
    expect(state.insertedOrganization).toBe(true)
    expect(state.insertedProfileType).toBe("SUPER_ADMIN")
  })
})
