import { describe, expect, it, vi } from "vitest"

import type { AccountContext } from "../lib/account-context"
import { authorizeUpload, isUploadKind } from "../lib/upload-access"

const USER_ID = "10000000-0000-0000-0000-0000000000aa"
const ORG_ID = "20000000-0000-0000-0000-0000000000bb"
const PROJECT_ID = "30000000-0000-0000-0000-0000000000cc"
const PRODUCT_ID = "40000000-0000-0000-0000-0000000000dd"

function context(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    user: { userId: USER_ID, email: "a@example.com", phone: null, name: "甲", role: "member" },
    account: {
      canManageTeam: false,
      canUsePointMap: true,
      isEnterprise: false,
      isSuperAdmin: false,
      status: "active",
      subscriptionStatus: null,
      type: "PERSONAL_FREE",
    },
    disabledFeatures: [],
    organization: null,
    permissions: ["project.view"],
    ...overrides,
  } as AccountContext
}

const superAdmin = () => context({
  account: { ...context().account, isSuperAdmin: true },
  permissions: ["account.manage_all", "platform.manage_features", "project.view", "project.edit"],
})

const withProjectEdit = () => context({ permissions: ["project.view", "project.edit"] })

describe('设备版管理员上传公司 logo', () => {
  it('平台管理员即使没有组织也能传（整台设备就是他的公司）', async () => {
    const result = await authorizeUpload(superAdmin(), 'company_logo', '')
    expect(result).toMatchObject({ folder: 'company-logos', ok: true, ownerId: 'platform' })
  })

  it('普通成员没有组织时仍然拒绝', async () => {
    const result = await authorizeUpload(context(), 'company_logo', '')
    expect(result).toMatchObject({ ok: false, reason: 'ORGANIZATION_REQUIRED' })
  })
})

describe("上传类型", () => {
  it("只认清单里有的类型，不认识的一律拒绝而不是兜底到某个目录", () => {
    expect(isUploadKind("contract")).toBe(true)
    expect(isUploadKind("随便写的")).toBe(false)
  })
})

describe('设备版管理员上传公司 logo', () => {
  it('平台管理员即使没有组织也能传（整台设备就是他的公司）', async () => {
    const result = await authorizeUpload(superAdmin(), 'company_logo', '')
    expect(result).toMatchObject({ folder: 'company-logos', ok: true, ownerId: 'platform' })
  })

  it('普通成员没有组织时仍然拒绝', async () => {
    const result = await authorizeUpload(context(), 'company_logo', '')
    expect(result).toMatchObject({ ok: false, reason: 'ORGANIZATION_REQUIRED' })
  })
})

describe("上传归属授权", () => {
  it.each(["missing", "expired", "disabled"])("拒绝 %s 账号上传，即使项目检查返回可写", async (state) => {
    const actor = withProjectEdit()
    if (state === "missing") actor.permissions = ["project.view"]
    if (state === "expired") actor.account.subscriptionStatus = "expired"
    if (state === "disabled") actor.account.status = "disabled"
    const canEditProject = vi.fn(async () => true)
    expect(await authorizeUpload(actor, "contract", PROJECT_ID, { canEditProject })).toMatchObject({ ok: false, status: 403 })
    expect(canEditProject).not.toHaveBeenCalled()
  })
  it("没登录直接拒绝", async () => {
    expect(await authorizeUpload(null, "contract", PROJECT_ID)).toMatchObject({ ok: false, status: 403 })
  })

  it("附件类必须是自己能编辑的项目，别人的项目一律 403", async () => {
    const canEditProject = vi.fn(async (id: string) => id === PROJECT_ID)

    expect(await authorizeUpload(withProjectEdit(), "contract", PROJECT_ID, { canEditProject }))
      .toMatchObject({ ok: true, folder: "contracts", ownerId: PROJECT_ID })
    expect(await authorizeUpload(withProjectEdit(), "floorplan", "99999999-0000-0000-0000-000000000000", { canEditProject }))
      .toMatchObject({ ok: false, reason: "RESOURCE_NOT_FOUND_OR_NOT_OWNED", status: 403 })
    // 项目 id 不是 uuid 时不去查库，直接 400，省一次查询也避免把垃圾写进路径。
    expect(await authorizeUpload(withProjectEdit(), "contract", "../../etc", { canEditProject }))
      .toMatchObject({ ok: false, reason: "PROJECT_ID_REQUIRED", status: 400 })
    expect(canEditProject).toHaveBeenCalledTimes(2)
  })

  it("头像只能传给自己：忽略表单里的 entityId", async () => {
    const result = await authorizeUpload(context(), "avatar", "别人的用户 id")
    expect(result).toMatchObject({ ok: true, folder: "avatars", ownerId: USER_ID })
  })

  it("公司标志只能传给自己的组织，且要有管理成员的权限", async () => {
    const enterprise = context({
      account: { ...context().account, canManageTeam: true, isEnterprise: true, type: "ENTERPRISE_OWNER" },
      organization: { id: ORG_ID, name: "甲公司", role: "owner" },
      permissions: ["enterprise.manage_members", "project.view"],
    })

    expect(await authorizeUpload(enterprise, "company_logo", "current"))
      .toMatchObject({ ok: true, folder: "company-logos", ownerId: ORG_ID })
    expect(await authorizeUpload(enterprise, "company_logo", ORG_ID)).toMatchObject({ ok: true })
    expect(await authorizeUpload(enterprise, "company_logo", "别的组织"))
      .toMatchObject({ ok: false, reason: "ORGANIZATION_MISMATCH", status: 403 })

    // 没有管理权限的成员不能换公司标志
    const member = context({
      organization: { id: ORG_ID, name: "甲公司", role: "viewer" },
      permissions: ["project.view"],
    })
    expect(await authorizeUpload(member, "company_logo", "current"))
      .toMatchObject({ ok: false, reason: "ORGANIZATION_LOGO_NOT_ALLOWED", status: 403 })
    // 没有组织（个人账号）也没有公司标志可换
    expect(await authorizeUpload(context(), "company_logo", "current"))
      .toMatchObject({ ok: false, reason: "ORGANIZATION_REQUIRED", status: 403 })
  })

  it("商品图与产品管理同一把锁：普通账号不能传", async () => {
    expect(await authorizeUpload(context(), "product_image", PRODUCT_ID))
      .toMatchObject({ ok: false, reason: "PLATFORM_ADMIN_REQUIRED", status: 403 })
    expect(await authorizeUpload(superAdmin(), "product_image", PRODUCT_ID))
      .toMatchObject({ ok: true, folder: "product-images", ownerId: PRODUCT_ID })
  })

  it("超级管理员传商品图时也要确认商品真的存在", async () => {
    const productExists = vi.fn(async () => false)
    expect(await authorizeUpload(superAdmin(), "product_image", PRODUCT_ID, { productExists }))
      .toMatchObject({ ok: false, reason: "PRODUCT_NOT_FOUND", status: 404 })
    expect(await authorizeUpload(superAdmin(), "product_image", "不是 uuid", { productExists }))
      .toMatchObject({ ok: false, reason: "PRODUCT_ID_REQUIRED", status: 400 })
  })

  it("认不出的类型拒绝并说明", async () => {
    expect(await authorizeUpload(superAdmin(), "随便写的", PROJECT_ID))
      .toMatchObject({ ok: false, reason: "UPLOAD_KIND_NOT_ALLOWED", status: 400 })
  })
})
