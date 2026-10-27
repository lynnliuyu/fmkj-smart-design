import { describe, expect, it } from "vitest"

import type { AccountContext } from "../lib/account-context"
import { canViewProductCost, stripProductCost, stripSnapshotCosts } from "../lib/product-cost"

function context(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    user: { userId: "u1", email: "a@example.com", phone: null, name: "甲", role: "member" },
    account: {
      canManageTeam: false, canUsePointMap: true, isEnterprise: false, isSuperAdmin: false,
      status: "active", subscriptionStatus: null, type: "PERSONAL_PRO",
    },
    disabledFeatures: [],
    organization: null,
    permissions: [],
    ...overrides,
  } as AccountContext
}

describe("谁能看产品成本", () => {
  it("does not expose costs to a disabled administrator", () => {
    expect(canViewProductCost(context({ account: { ...context().account, isSuperAdmin: true, status: "disabled" } }))).toBe(false)
  })
  it("removes legacy nested costs without mutating the stored snapshot", () => {
    const snapshot = { name: "Product", cost: 10, nested: { costPrice: 20, price: 30 }, parts: [{ cost_amount: 40, quantity: 2 }] }
    expect(stripSnapshotCosts(snapshot)).toEqual({ name: "Product", nested: { price: 30 }, parts: [{ quantity: 2 }] })
    expect(snapshot.cost).toBe(10)
    expect(snapshot.nested.costPrice).toBe(20)
  })
  it("个人账号自己看：账是自己的，没有第三人", () => {
    expect(canViewProductCost(context())).toBe(true)
    expect(canViewProductCost(context({ account: { ...context().account, type: "PERSONAL_FREE" } as never }))).toBe(true)
  })

  it("企业主能看", () => {
    expect(canViewProductCost(context({
      account: { ...context().account, type: "ENTERPRISE_OWNER", isEnterprise: true } as never,
      organization: { id: "o1", name: "甲公司", role: "owner" },
    }))).toBe(true)
  })

  it("企业里的编辑与查看者看不到", () => {
    for (const role of ["editor", "viewer", "member_enterprise"]) {
      expect(canViewProductCost(context({
        account: { ...context().account, type: "ENTERPRISE_MEMBER", isEnterprise: true } as never,
        organization: { id: "o1", name: "甲公司", role },
      }))).toBe(false)
    }
  })

  it("管理员、经理、财务能看；有财务权限的也能看", () => {
    for (const role of ["admin", "manager", "finance"]) {
      expect(canViewProductCost(context({
        account: { ...context().account, type: "ENTERPRISE_MEMBER", isEnterprise: true } as never,
        organization: { id: "o1", name: "甲公司", role },
      }))).toBe(true)
    }
    expect(canViewProductCost(context({
      account: { ...context().account, type: "ENTERPRISE_MEMBER", isEnterprise: true } as never,
      organization: { id: "o1", name: "甲公司", role: "viewer" },
      permissions: ["enterprise.manage_billing"],
    }))).toBe(true)
  })

  it("平台超管能看，未登录不能看", () => {
    expect(canViewProductCost(context({ account: { ...context().account, isSuperAdmin: true } as never }))).toBe(true)
    expect(canViewProductCost(null)).toBe(false)
  })

  it("摘掉成本时其它字段原样保留", () => {
    const product = { cost: 120, id: "p1", name: "开关", price: 199 }
    expect(stripProductCost(product)).toEqual({ id: "p1", name: "开关", price: 199 })
    expect("cost" in stripProductCost(product)).toBe(false)
  })
})
