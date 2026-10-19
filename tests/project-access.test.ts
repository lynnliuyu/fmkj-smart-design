import { describe, expect, it } from "vitest"

import { buildAccountContext } from "../lib/account-context.js"
import {
  projectVisibilityWhere,
  resolveProjectOwnerScope,
} from "../lib/project-access.js"
import type { AuthUser } from "../lib/auth.js"

const sessionUser: AuthUser = {
  email: "member@example.com",
  name: "Member",
  phone: null,
  role: "member",
  userId: "user_1",
}

describe("project access scope", () => {
  it("uses personal ownership for personal accounts", () => {
    const context = buildAccountContext(sessionUser)

    expect(resolveProjectOwnerScope(context)).toEqual({
      ownerId: "user_1",
      ownerType: "user",
    })
    expect(projectVisibilityWhere(context).params).toEqual(["user_1"])
  })

  it("uses organization ownership for enterprise contexts", () => {
    const context = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_OWNER",
        id: "user_1",
        role: "owner",
        status: "active",
      },
      { id: "org_1", name: "方明科技", role: "管理员" }
    )

    expect(resolveProjectOwnerScope(context)).toEqual({
      ownerId: "org_1",
      ownerType: "organization",
    })
    expect(projectVisibilityWhere(context).where).toContain("p.owner_id = $1::uuid")
  })

  it("filters enterprise members to created or granted projects", () => {
    const context = buildAccountContext(
      sessionUser,
      {
        account_status: "active",
        account_type: "ENTERPRISE_MEMBER",
        id: "user_1",
        role: "viewer",
        status: "active",
      },
      { id: "org_1", name: "方明科技", role: "查看者" }
    )

    const visibility = projectVisibilityWhere(context, 1)

    expect(visibility.params).toEqual(["org_1", "user_1"])
    expect(visibility.where).toContain("project_members")
    expect(visibility.where).toContain("p.owner_id = $2::uuid")
    expect(visibility.where).toContain("pm.user_id = $3::uuid")
  })
})
