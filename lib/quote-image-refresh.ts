import type { Pool } from "pg"
import type { AccountContext } from "./account-context"
import { getPool } from "./server-db"
import { assertPermission, assertWritableMembership, PointMapServiceError, requireContext, requireVisibleProject } from "./point-map-service"
import { loadProductVisualAssets } from "./product-visual-assets-service"
import { usableProductImage } from "./product-image-source"

export type QuoteImageRefreshInput = { projectId: string; quoteId: string; expectedUpdatedAt: string }
export type QuoteImageRefreshResult = {
  quoteId: string
  updatedAt: string
  updated: number
  products: Array<{ id: string; image: string; productSnapshot: Record<string, unknown> }>
}

/** Update photos only. Unsubmitted prices, room moves and removals never enter this operation. */
export async function refreshQuoteImages(context: AccountContext | null, input: QuoteImageRefreshInput, dependencies: { db?: Pool } = {}): Promise<QuoteImageRefreshResult> {
  const account = requireContext(context, input.projectId)
  if (!/^[0-9a-f-]{36}$/i.test(input.quoteId) || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
    throw new PointMapServiceError("INVALID_QUOTE_IMAGE_REFRESH", 400, "请刷新报价后再更新图片。")
  }
  const client = await (dependencies.db ?? getPool()).connect()
  try {
    await client.query("begin")
    const project = await requireVisibleProject(client, account, input.projectId, true)
    assertPermission(account, "project.edit")
    assertWritableMembership(account, project)
    const quote = (await client.query<{ id: string; updatedAt: Date | string }>(`
      select id::text, updated_at as "updatedAt" from quotes
      where project_id=$1::uuid and status='draft' and deleted_at is null
      order by updated_at desc limit 1 for update`, [input.projectId])).rows[0]
    const currentTime = quote && new Date(quote.updatedAt).toISOString()
    if (!quote || quote.id !== input.quoteId || currentTime !== new Date(input.expectedUpdatedAt).toISOString()) {
      throw new PointMapServiceError("QUOTE_IMAGE_REFRESH_CONFLICT", 409, "报价已被更新，请刷新后重试；本次未覆盖任何内容。")
    }
    const products = (await client.query<{ id: string; image: string | null }>(`
      select distinct p.id::text, p.image from products p join quote_items qi on qi.product_id=p.id
      where qi.quote_id=$1::uuid and qi.deleted_at is null and p.deleted_at is null`, [quote.id])).rows
    const visuals = await loadProductVisualAssets(client, products.map((product) => product.id))
    const changed: QuoteImageRefreshResult["products"] = []
    let updated = 0
    for (const product of products) {
      const candidate = visuals.get(product.id)
      const visualImage = usableProductImage(candidate?.image)
      const visual = visualImage ? candidate : null
      const image = visualImage ?? usableProductImage(product.image)
      if (!image) continue
      await client.query(`update quote_items qi set product_snapshot=jsonb_build_object(
        'version',1,'origin','quote-image-refresh','name',coalesce(qi.name,p.name),'sku',p.sku,
        'spec',coalesce(qi.note,p.description,p.sku),'unit',coalesce(qi.unit,p.unit,'个'),'category',p.category,'image',p.image)
        from products p where qi.product_id=p.id and p.id=$2::uuid and qi.quote_id=$1::uuid and qi.deleted_at is null and qi.product_snapshot is null`, [quote.id, product.id])
      const result = await client.query<{ productSnapshot: Record<string, unknown> }>(`
        update quote_items set product_snapshot=jsonb_set(
          jsonb_set(product_snapshot, '{image}', to_jsonb($3::text), true),
          '{visualAsset}', $4::jsonb, true)
        where quote_id=$1::uuid and product_id=$2::uuid and deleted_at is null
          and (product_snapshot->>'image' is distinct from $3::text
            or product_snapshot->'visualAsset' is distinct from $4::jsonb)
        returning product_snapshot as "productSnapshot"`, [quote.id, product.id, image, JSON.stringify(visual ?? null)])
      if (result.rows.length) {
        updated += result.rows.length
        changed.push({ id: product.id, image, productSnapshot: result.rows[0].productSnapshot })
      }
    }
    let updatedAt = currentTime!
    if (updated) {
      const result = await client.query<{ updatedAt: Date | string }>(`
        update quotes set updated_at=now(),updated_by=$2::uuid where id=$1::uuid returning updated_at as "updatedAt"`, [quote.id, account.user.userId])
      updatedAt = new Date(result.rows[0].updatedAt).toISOString()
      await client.query(`insert into activity_logs(actor_id,entity_type,entity_id,entity_label,action,title,description,metadata)
        values($1::uuid,'project',$2::uuid,'方案报价','quote.images_refreshed','更新报价商品图片',$3,$4::jsonb)`,
      [account.user.userId, input.projectId, `更新 ${updated} 条报价图片，保留数量、价格和点位。`, JSON.stringify({ quoteId: quote.id, products: changed.map((product) => product.id) })])
    }
    await client.query("commit")
    return { quoteId: quote.id, updatedAt, updated, products: changed }
  } catch (error) { await client.query("rollback"); throw error } finally { client.release() }
}
