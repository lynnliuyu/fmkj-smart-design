import { getPool } from "./server-db"
import { lineAmount, sumMoney } from "./money"
import type { AccountContext } from "./account-context"
import { assertPermission, assertWritableMembership, requireContext, requireVisibleProject } from "./point-map-service"
import { saveQuoteDraft, type QuoteItemPayload, type SaveQuoteDraftInput } from "./quote-save"
import {
  computeModuleQuantity,
  QUICK_MODULES,
  QUICK_PLATFORMS,
  QUICK_TIERS,
  type QuickQuoteInput,
  type QuickQuoteResult,
} from "./quick-quote-shared"

export {
  computeModuleQuantity,
  QUICK_MODULES,
  QUICK_PLATFORMS,
  QUICK_TIERS,
}
export type {
  QuickModule,
  QuickQuoteInput,
  QuickQuoteResult,
  QuickTier,
} from "./quick-quote-shared"

export class QuickQuoteError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code)
  }
}

type ProductRow = {
  id: string
  name: string
  category: string
  platform: string
  price: number
  cost: number
  unit: string
}

export async function generateQuickQuote(
  context: AccountContext,
  input: QuickQuoteInput,
): Promise<QuickQuoteResult> {
  const projectId = String(input.projectId ?? "").trim()
  if (!projectId) throw new QuickQuoteError("PROJECT_REQUIRED", 400)
  if (!input.modules.length) throw new QuickQuoteError("MODULES_REQUIRED", 400)
  if (input.bedrooms < 0 || input.livingRooms <= 0) {
    throw new QuickQuoteError("INVALID_ROOM_COUNT", 400)
  }

  // 快速报价会直接写入报价草稿，必须和普通报价保存使用同一套项目写权限。
  // 先锁定并校验项目，避免只读成员或订阅已过期的账号绕过报价页入口。
  const account = requireContext(context, projectId)
  const accessClient = await getPool().connect()
  try {
    await accessClient.query("begin")
    const project = await requireVisibleProject(accessClient, account, projectId, true)
    assertPermission(account, "project.edit")
    assertWritableMembership(account, project)
    await accessClient.query("commit")
  } catch (error) {
    await accessClient.query("rollback")
    throw error
  } finally {
    accessClient.release()
  }

  const items: QuoteItemPayload[] = []
  let subtotal = 0

  for (const moduleKey of input.modules) {
    const moduleDef = QUICK_MODULES.find((entry) => entry.key === moduleKey)
    if (!moduleDef) continue

    const qty = computeModuleQuantity(moduleKey, input.tier, input.bedrooms, input.livingRooms)
    const product = await pickProductForModule(moduleDef.category, input.platform)
    if (!product) continue

    const unitPrice = Number(product.price) || 0
    const cost = Number(product.cost) || 0
    const lineTotal = lineAmount(unitPrice, qty)
    subtotal = sumMoney([subtotal, lineTotal])

    items.push({
      productId: product.id,
      name: product.name,
      spec: `${product.platform} · ${product.category}`,
      room: moduleDef.room,
      unit: product.unit || "个",
      quantity: qty,
      price: unitPrice,
      cost,
      discount: 100,
    })
  }

  if (items.length === 0) {
    throw new QuickQuoteError("NO_MATCHING_PRODUCTS", 422)
  }

  const saveInput: SaveQuoteDraftInput = {
    projectId,
    items,
    subtotal,
    total: subtotal,
    discount: 0,
    installationFee: 0,
    rooms: [],
  }

  const result = await saveQuoteDraft(saveInput, {
    context: account,
    actorName: context.user.name,
    actorUserId: context.user.userId,
  })

  return {
    id: result.id,
    quoteNo: result.quoteNo,
    savedItems: result.savedItems,
    skippedItems: result.skippedItems,
    subtotal,
    total: subtotal,
  }
}

async function pickProductForModule(
  category: string,
  platform: string,
): Promise<ProductRow | null> {
  // 1. 平台 + 类目 取价格最低
  const platformRow = await getPool().query(
    `select
       id::text as id,
       name,
       category,
       platform,
       price::float8 as price,
       cost::float8 as cost,
       coalesce(unit, '个') as unit
     from products
     where deleted_at is null
       and status = 'active'
       and category = $1
       and ($2 = any(coalesce(platforms, '{}'::text[])) or platform = $2)
       and price > 0
     order by price asc
     limit 1`,
    [category, platform],
  )
  if (platformRow.rows[0]) return platformRow.rows[0] as ProductRow

  // 2. 回退：类目下任一平台最便宜的
  const fallbackRow = await getPool().query(
    `select
       id::text as id,
       name,
       category,
       platform,
       price::float8 as price,
       cost::float8 as cost,
       coalesce(unit, '个') as unit
     from products
     where deleted_at is null
       and status = 'active'
       and category = $1
       and price > 0
     order by price asc
     limit 1`,
    [category],
  )
  return (fallbackRow.rows[0] as ProductRow) ?? null
}