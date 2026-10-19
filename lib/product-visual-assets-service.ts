import type { Pool, PoolClient } from "pg"

import { getPool } from "./server-db"
import { defaultProductVisualAsset, parseProductVisualAssetMutation, ProductVisualValidationError, type ProductVisualAsset } from "./product-visual-assets"

type Queryable = Pick<Pool | PoolClient, "query">
type VisualRow = {
  product_id: string; image: string; source_image: string; crop: ProductVisualAsset["crop"]
  scale: number | string; review_status: ProductVisualAsset["reviewStatus"]; evidence: string
  revision: number; updated_at: Date | string
}
type ProductImageRow = { id: string; name: string; image: string | null; updated_at: Date | string }
export type AdminProductVisualAsset = { productId: string; originalImage: string | null; visual: ProductVisualAsset }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function dateString(value: Date | string) { return value instanceof Date ? value.toISOString() : value }
function mapVisual(row: VisualRow): ProductVisualAsset {
  return { image: row.image, sourceImage: row.source_image, crop: row.crop, scale: Number(row.scale), reviewStatus: row.review_status, evidence: row.evidence, revision: Number(row.revision), updatedAt: dateString(row.updated_at) }
}
function validateProductId(productId: string) {
  if (!uuidPattern.test(productId)) throw new ProductVisualValidationError({ productId: "产品标识无效" })
}

/** Only saved display derivatives are returned; callers retain their existing image fallback. */
export async function loadProductVisualAssets(db: Queryable, ids: string[]): Promise<Map<string, ProductVisualAsset>> {
  const productIds = [...new Set(ids.filter((id) => uuidPattern.test(id)))]
  if (!productIds.length) return new Map()
  const result = await db.query<VisualRow>(`
    select v.* from product_visual_assets v join products p on p.id=v.product_id
    where v.product_id=any($1::uuid[]) and p.deleted_at is null`, [productIds])
  return new Map(result.rows.map((row) => [row.product_id, mapVisual(row)]))
}

export async function getAdminProductVisualAsset(productId: string): Promise<AdminProductVisualAsset> {
  validateProductId(productId)
  const db = getPool()
  const result = await db.query<ProductImageRow>("select id::text, name, image, updated_at from products where id=$1::uuid and deleted_at is null", [productId])
  const product = result.rows[0]
  if (!product) throw new ProductVisualValidationError({ productId: "产品不存在或已删除" }, 404)
  const assets = await loadProductVisualAssets(db, [productId])
  return { productId, originalImage: product.image, visual: assets.get(productId) ?? defaultProductVisualAsset(product.image, dateString(product.updated_at)) }
}

export async function saveAdminProductVisualAsset(input: { productId: string; actorUserId: string; mutation: unknown }): Promise<AdminProductVisualAsset> {
  validateProductId(input.productId)
  const mutation = parseProductVisualAssetMutation(input.mutation)
  const db = await getPool().connect()
  try {
    await db.query("begin")
    // The parent row also serializes the first insert, when no visual row exists yet.
    const productResult = await db.query<ProductImageRow>("select id::text, name, image, updated_at from products where id=$1::uuid and deleted_at is null for update", [input.productId])
    const product = productResult.rows[0]
    if (!product) throw new ProductVisualValidationError({ productId: "产品不存在或已删除" }, 404)
    const existing = await db.query<VisualRow>("select * from product_visual_assets where product_id=$1::uuid for update", [input.productId])
    const before = existing.rows[0] ? mapVisual(existing.rows[0]) : null
    if (mutation.expectedRevision !== (before?.revision ?? 0)) throw new ProductVisualValidationError({ expectedRevision: "展示图已被其他人更新，请重新载入后再保存" }, 409)
    const result = await db.query<VisualRow>(`
      insert into product_visual_assets (product_id,image,source_image,crop,scale,review_status,evidence,revision,updated_by,updated_at)
      values ($1::uuid,$2,$3,$4::jsonb,$5,$6,$7,1,$8::uuid,now())
      on conflict (product_id) do update set image=excluded.image,source_image=excluded.source_image,crop=excluded.crop,
        scale=excluded.scale,review_status=excluded.review_status,evidence=excluded.evidence,
        revision=product_visual_assets.revision+1,updated_by=excluded.updated_by,updated_at=now()
      returning *`, [input.productId, mutation.image, mutation.sourceImage, mutation.crop === null ? null : JSON.stringify(mutation.crop), mutation.scale, mutation.reviewStatus, mutation.evidence ?? "", input.actorUserId])
    const visual = mapVisual(result.rows[0])
    await db.query(`
      insert into activity_logs (actor_id,entity_type,entity_id,entity_label,action,title,description,metadata)
      values ($1::uuid,'product',$2::uuid,$3,'product.visual_updated','商品展示图已更新',$4,$5::jsonb)`,
    [input.actorUserId, input.productId, product.name, `更新 ${product.name} 的展示图，版本 ${visual.revision}`, JSON.stringify({ before, after: visual })])
    await db.query("commit")
    return { productId: input.productId, originalImage: product.image, visual }
  } catch (error) {
    await db.query("rollback")
    throw error
  } finally { db.release() }
}
