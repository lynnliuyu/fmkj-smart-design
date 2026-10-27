import { accountContextCan, type AccountContext } from "./account-context"

/**
 * 谁能看产品进货成本。
 *
 * 背景：`/api/products` 原来把每个产品的 `cost` 发给所有登录账号。产品库页面确实要显示成本与
 * 毛利率，但那是「经营者」视角——企业里的编辑、查看者不需要知道进货价，也不该能从接口里捞到。
 *
 * 规则（宁可保守，也不把所有人的界面一下改空）：
 *   - 平台超管：能看；
 *   - 个人账号、企业主：自己的账自己看，能看；
 *   - 企业成员：只有 owner / admin / manager / finance，或持有财务权限的人能看；
 *   - 其余（editor / viewer 等）：接口不返回成本，界面上显示「仅管理者可见」。
 *
 * 注意：隐藏成本**不能**让报价少记成本——`quote-save` 在成本为空时会用目录里的成本兜底，
 * 这样普通销售保存的报价，管理者看到的毛利仍然是对的。
 */
const COST_ROLES = new Set(["owner", "admin", "manager", "finance", "enterprise_owner"])

export function canViewProductCost(context: AccountContext | null): boolean {
  if (!context || context.account.status !== "active") return false
  if (context.account.isSuperAdmin) return true
  // 个人账号与企业主：账是自己的，不存在「不该看进货价」的第三人。
  if (context.account.type !== "ENTERPRISE_MEMBER") return true
  if (accountContextCan(context, "enterprise.manage_billing")) return true
  const role = String(context.organization?.role ?? "").trim().toLowerCase()
  return COST_ROLES.has(role)
}

/** 把成本从返回给前端的商品对象里摘掉；其它字段原样保留。 */
export function stripProductCost<T extends { cost?: number | null }>(product: T): Omit<T, "cost"> {
  const { cost: _cost, ...rest } = product
  return rest
}

const INTERNAL_COST_FIELDS = new Set(["cost", "cost_price", "costPrice", "cost_amount", "costAmount"])

/** Old product snapshots can include nested internal costs; never send them to ordinary members. */
export function stripSnapshotCosts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSnapshotCosts)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !INTERNAL_COST_FIELDS.has(key))
    .map(([key, entry]) => [key, stripSnapshotCosts(entry)]))
}
