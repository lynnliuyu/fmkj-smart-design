import type { Pool } from "pg"

import type { AccountContext } from "./account-context"
import { assertPermission, assertWritableMembership, PointMapServiceError, requireContext, requireVisibleProject } from "./point-map-service"
import { getPool } from "./server-db"
import { isCountableByPoint } from "./product-selection"
import { mapProduct, productColumns, type ProductRow } from "./product-admin-service"
import { servesKeyCount } from "./category-default-keys"

export type CategoryDefaultChoice = { deviceTypeId: string; buttonCount: number; productId: string | null }

const DEVICE_TYPE_PATTERN = /^[a-z0-9-]{1,64}$/
/** 只有开关类支持按键数区分；0 表示全部键数。 */
const KEYED_DEVICE_TYPES = new Set(["wall-switch"])

/**
 * 批量统一换型号：按设备类型 + 键数（0 = 全部）指定同步时采用的型号。
 * productId 为 null 时清除该设置，恢复标准规则。
 */
export async function setCategoryDefaultProduct(
  context: AccountContext | null,
  input: { projectId: string; deviceTypeId: unknown; buttonCount?: unknown; productId: unknown },
  db: Pick<Pool, "connect"> = getPool(),
): Promise<void> {
  const account = requireContext(context, input.projectId)
  assertPermission(account, "project.edit")
  assertPermission(account, "point_map.use")
  const deviceTypeId = typeof input.deviceTypeId === "string" ? input.deviceTypeId.trim() : ""
  if (!DEVICE_TYPE_PATTERN.test(deviceTypeId)) throw new PointMapServiceError("INVALID_DEVICE_TYPE", 400)
  const buttonCount = input.buttonCount === undefined || input.buttonCount === null ? 0 : Number(input.buttonCount)
  if (!Number.isInteger(buttonCount) || buttonCount < 0 || buttonCount > 4) throw new PointMapServiceError("INVALID_BUTTON_COUNT", 400)
  if (buttonCount > 0 && !KEYED_DEVICE_TYPES.has(deviceTypeId)) throw new PointMapServiceError("KEY_COUNT_NOT_SUPPORTED", 400)
  const client = await db.connect()
  try {
    await client.query("begin")
    const project = await requireVisibleProject(client, account, input.projectId, true)
    assertWritableMembership(account, project)
    if (input.productId === null || input.productId === "") {
      await client.query("delete from project_category_default_products where project_id = $1::uuid and device_type_id = $2 and button_count = $3", [input.projectId, deviceTypeId, buttonCount])
    } else {
      if (typeof input.productId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.productId)) throw new PointMapServiceError("INVALID_PRODUCT", 400)
      const result = await client.query<ProductRow>(
        `select ${productColumns()} from products where id = $1::uuid and deleted_at is null and status in ('active','approved')`,
        [input.productId],
      )
      const product = result.rows[0] ? mapProduct(result.rows[0]) : null
      if (!product || product.deviceTypeId !== deviceTypeId || !isCountableByPoint(product)) throw new PointMapServiceError("PRODUCT_NOT_IN_CATEGORY", 400)
      // 键数为 0 时需要主型号；指定键数时可以是本身带该键数的产品，或带该键数子规格的主型号。
      if (buttonCount === 0 && product.parentProductId) throw new PointMapServiceError("PRODUCT_NOT_IN_CATEGORY", 400)
      if (buttonCount > 0) {
        const siblings = await client.query<ProductRow>(
          `select ${productColumns()} from products where device_type_id = $1 and deleted_at is null and status in ('active','approved')`,
          [deviceTypeId],
        )
        const all = siblings.rows.map(mapProduct)
        if (!servesKeyCount(product, buttonCount, all)) throw new PointMapServiceError("PRODUCT_KEY_COUNT_MISMATCH", 400)
      }
      await client.query(
        `insert into project_category_default_products (project_id, device_type_id, button_count, product_id, updated_by) values ($1::uuid, $2, $3, $4::uuid, $5)
         on conflict (project_id, device_type_id, button_count) do update set product_id = excluded.product_id, updated_at = now(), updated_by = excluded.updated_by`,
        [input.projectId, deviceTypeId, buttonCount, input.productId, account.user.userId],
      )
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally { client.release() }
}

export async function listCategoryDefaultProducts(context: AccountContext | null, projectId: string, db: Pick<Pool, "connect"> = getPool()): Promise<CategoryDefaultChoice[]> {
  const account = requireContext(context, projectId)
  assertPermission(account, "point_map.use")
  const client = await db.connect()
  try {
    await client.query("begin")
    await requireVisibleProject(client, account, projectId)
    const result = await client.query<{ device_type_id: string; button_count: number; product_id: string }>(
      "select device_type_id, button_count, product_id::text from project_category_default_products where project_id = $1::uuid order by device_type_id, button_count", [projectId],
    )
    await client.query("commit")
    return result.rows.map((row) => ({ deviceTypeId: row.device_type_id, buttonCount: row.button_count, productId: row.product_id }))
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally { client.release() }
}

