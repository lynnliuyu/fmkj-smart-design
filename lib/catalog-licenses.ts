/**
 * 一机一密：客户设备的取资料凭据。
 *
 * 设计取舍：
 *   - 库里只存 **sha256 哈希 + 前缀**，不存明文。备份泄露也拿不去取资料；明文只在创建时给一次。
 *   - 校验是「哈希查表 + enabled」，能单独停用某台设备；同时记录设备报上来的实例标识与最后取用时间，
 *     运营方能看出「哪台还在用、哪台已经不用了」。
 *   - 环境变量 `CATALOG_PUBLISH_TOKEN` 仍然有效：自部署版用它当唯一的凭据（不开一机一密也能跑），
 *     主站则用它当「总钥匙」，便于排障时临时取一份。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { getPool } from "./server-db"

export type CatalogLicense = {
  id: string
  enabled: boolean
  instanceId: string | null
  keyPrefix: string
  label: string
  lastSeenAt: string | null
  note: string | null
}

type Row = {
  id: string
  enabled: boolean
  instance_id: string | null
  key_prefix: string
  label: string
  last_seen_at: Date | string | null
  note: string | null
}

function mapRow(row: Row): CatalogLicense {
  return {
    id: row.id,
    enabled: row.enabled,
    instanceId: row.instance_id,
    keyPrefix: row.key_prefix,
    label: row.label,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    note: row.note,
  }
}

export function catalogLicenseHash(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex")
}

/** 生成一个新凭据：`fmkj_` + 32 位随机十六进制。 */
export function generateCatalogLicenseKey(): string {
  return `fmkj_${randomBytes(16).toString("hex")}`
}

export async function listCatalogLicenses(): Promise<CatalogLicense[]> {
  const result = await getPool().query<Row>(
    `select id, enabled, instance_id, key_prefix, label, last_seen_at, note
     from catalog_licenses order by created_at desc`,
  )
  return result.rows.map(mapRow)
}

/** 新建凭据：返回明文一次，之后库里只有哈希。 */
export async function createCatalogLicense(input: { label: string; note?: string | null }): Promise<{ key: string; license: CatalogLicense }> {
  const label = String(input.label ?? "").trim()
  if (!label) throw new Error("请填写这台设备是谁在用（例如客户名或设备编号）")
  const key = generateCatalogLicenseKey()
  const result = await getPool().query<Row>(
    `insert into catalog_licenses (key_hash, key_prefix, label, note)
     values ($1, $2, $3, $4)
     returning id, enabled, instance_id, key_prefix, label, last_seen_at, note`,
    [catalogLicenseHash(key), key.slice(0, 12), label, input.note ? String(input.note) : null],
  )
  return { key, license: mapRow(result.rows[0]) }
}

export async function updateCatalogLicense(input: { id: string; enabled?: boolean; label?: string; note?: string | null }): Promise<CatalogLicense> {
  const id = String(input.id ?? "").trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("凭据 id 无效")
  const sets: string[] = []
  const params: unknown[] = [id]
  if (input.enabled !== undefined) { params.push(Boolean(input.enabled)); sets.push(`enabled = $${params.length}`) }
  if (input.label !== undefined) {
    const label = String(input.label).trim()
    if (!label) throw new Error("名称不能为空")
    params.push(label); sets.push(`label = $${params.length}`)
  }
  if (input.note !== undefined) { params.push(input.note ? String(input.note) : null); sets.push(`note = $${params.length}`) }
  if (!sets.length) throw new Error("没有要修改的内容")
  const result = await getPool().query<Row>(
    `update catalog_licenses set ${sets.join(", ")}, updated_at = now() where id = $1::uuid
     returning id, enabled, instance_id, key_prefix, label, last_seen_at, note`,
    params,
  )
  if (!result.rows[0]) throw new Error("凭据不存在")
  return mapRow(result.rows[0])
}

/** 校验一份凭据；对得上且启用中才算通过。 */
export async function verifyCatalogLicense(key: string): Promise<CatalogLicense | null> {
  const trimmed = String(key ?? "").trim()
  if (!trimmed) return null
  const result = await getPool().query<Row>(
    `select id, enabled, instance_id, key_prefix, label, last_seen_at, note
     from catalog_licenses where key_hash = $1 and enabled limit 1`,
    [catalogLicenseHash(trimmed)],
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

/** 记一次取用：谁在用、什么时候用的。失败不影响取资料。 */
export async function recordCatalogLicenseUse(id: string, instanceId: string | null): Promise<void> {
  try {
    await getPool().query(
      `update catalog_licenses set last_seen_at = now(), instance_id = coalesce($2, instance_id), updated_at = now()
       where id = $1::uuid`,
      [id, instanceId ? String(instanceId).slice(0, 120) : null],
    )
  } catch {
    // 记录失败不该让客户取不到资料
  }
}

/** 常量时间比较，给环境变量里的「总钥匙」用。 */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
