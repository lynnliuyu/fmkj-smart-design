import { defaultSellingPrice } from "./product-pricing"
import type { Pool } from "pg"

import type { AccountContext } from "./account-context"
import { assertPermission, assertWritableMembership, PointMapServiceError, requireContext, requireVisibleProject } from "./point-map-service"
import { validateDesignPlan } from "./point-map-design"
import { buildProcurementPreview, defaultButtonCountForPoint, defaultDeviceTypeForPoint, type PointMapProcurementPreview, type PointMapProcurementPreviewResponse } from "./point-map-procurement"
import { loadCategoryDefaultProducts, loadSelectionProducts } from "./point-map-selection-service"
import { canViewProductCost, stripSnapshotCosts } from "./product-cost"
import { getPool } from "./server-db"
import type { PointMapPlan } from "./point-map-plan"
import type { SelectionClient } from "./point-map-selection-service"

export async function buildStoredProcurementPreview(client: SelectionClient, projectId: string, expectedRevision: number): Promise<PointMapProcurementPreview> {
  const result = await client.query<{ plan: PointMapPlan; revision: number }>(
    `select plan, revision from project_point_map_designs where project_id = $1::uuid for share`, [projectId],
  )
  const row = result.rows[0]
  if (!row || row.revision !== expectedRevision) throw new PointMapServiceError("POINT_MAP_REVISION_CONFLICT", 409, "点位方案已变化，请保存并重新预览报价。", row?.revision ?? 0)
  const plan = validateDesignPlan(row.plan, projectId)
  const products = await loadSelectionProducts(client, plan.points.flatMap((point) => [point.productId, ...(point.materials ?? []).map((material) => material.productId)]))
  const categoryDefaults = await loadCategoryDefaultProducts(client, projectId, plan.points.filter((point) => !point.productId).map((point) => ({ deviceTypeId: defaultDeviceTypeForPoint(point) ?? "", buttonCount: defaultButtonCountForPoint(point) })))
  // 项目专属价格优先于产品库售价；成本仍取产品库。
  const projectPrices = await client.query<{ product_id: string; unit_price: string; cost_price: string | null }>(
    `select product_id::text, unit_price::text, cost_price::text from project_product_prices where project_id = $1::uuid`,
    [projectId],
  )
  const projectPrice = new Map(projectPrices.rows.map((row) => [row.product_id, Number(row.unit_price)]))
  const toProcurement = (product: (typeof products)[number]) => ({ ...product, price: projectPrice.get(product.id) ?? defaultSellingPrice(product.price, product.cost), spec: product.description ?? product.sku, category: product.category ?? "其他", image: product.image ?? "/placeholder.svg" })
  return buildProcurementPreview(
    plan,
    row.revision,
    products.map(toProcurement),
    "当前项目",
    new Map([...categoryDefaults].map(([deviceTypeId, product]) => [deviceTypeId, toProcurement(product)])),
  )
}

export async function previewPointMapProcurement(context: AccountContext | null, projectId: string, expectedRevision: unknown, db: Pick<Pool, "connect"> = getPool()): Promise<PointMapProcurementPreviewResponse> {
  const account = requireContext(context, projectId)
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new PointMapServiceError("INVALID_POINT_MAP_REVISION", 400)
  const client = await db.connect()
  try {
    await client.query("begin isolation level repeatable read")
    const project = await requireVisibleProject(client, account, projectId)
    assertPermission(account, "point_map.use")
    assertPermission(account, "project.edit")
    assertWritableMembership(account, project)
    const result = await buildStoredProcurementPreview(client, projectId, Number(expectedRevision))
    await client.query("commit")
    return canViewProductCost(account) ? result : stripSnapshotCosts(result) as PointMapProcurementPreviewResponse
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally { client.release() }
}
