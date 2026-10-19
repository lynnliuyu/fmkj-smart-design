import { describe, expect, it } from "vitest"
import { buildAccountContext } from "../lib/account-context"
import { listCategoryDefaultProducts, setCategoryDefaultProduct } from "../lib/category-default-products-service"
import { loadCategoryDefaultProducts } from "../lib/point-map-selection-service"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const USER = "33333333-3333-4333-8333-333333333333"
const PRODUCT = "44444444-4444-4444-8444-444444444444"
const context = (member = false) => buildAccountContext(
  { userId: USER, name: "Synthetic user", role: "pro" },
  { id: USER, account_type: member ? "ENTERPRISE_MEMBER" : "PERSONAL_PRO", account_status: "active", role: "pro" },
  member ? { id: B, name: "Synthetic team", role: "editor" } : null,
)
const product = { id: PRODUCT, name: "Synthetic default", sku: "SYN-2", unit: "个", device_type_id: "wall-switch", category: "开关", catalog_kind: "sku", specs: { button_count: 2 }, status: "active", price: 100, cost: 50, selection_status: "pending", pricing_status: "pending", created_at: new Date(), updated_at: new Date() }

class MemoryDefaults {
  choices = new Map<string, { device_type_id: string; button_count: number; product_id: string }>()
  calls: string[] = []
  visible = true
  readOnly = false
  released = 0
  query = async (sql: string, params: unknown[] = []) => {
    this.calls.push(sql)
    if (sql.includes("from projects p")) return { rows: this.visible ? [{ createdBy: USER, accessLevel: this.readOnly ? "view" : "edit" }] : [] }
    if (sql.includes("from products")) return { rows: [product] }
    const key = `${params[0]}:${params[1]}:${params[2]}`
    if (sql.startsWith("insert into project_category")) this.choices.set(key, { device_type_id: String(params[1]), button_count: Number(params[2]), product_id: String(params[3]) })
    if (sql.startsWith("delete from project_category")) this.choices.delete(key)
    if (sql.includes("from project_category")) return { rows: [...this.choices].filter(([key]) => key.startsWith(`${params[0]}:`)).map(([, row]) => row) }
    return { rows: [] }
  }
  release = () => { this.released++ }
  db = () => ({ connect: async () => this }) as never
}

describe("project-scoped category defaults", () => {
  it("applies and restores A without changing B or writing the legacy global table", async () => {
    const store = new MemoryDefaults()
    for (const projectId of [A, B]) await setCategoryDefaultProduct(context(), { projectId, deviceTypeId: "wall-switch", buttonCount: 2, productId: PRODUCT }, store.db())
    await setCategoryDefaultProduct(context(), { projectId: A, deviceTypeId: "wall-switch", buttonCount: 2, productId: null }, store.db())
    expect(await listCategoryDefaultProducts(context(), A, store.db())).toEqual([])
    expect(await listCategoryDefaultProducts(context(), B, store.db())).toEqual([{ deviceTypeId: "wall-switch", buttonCount: 2, productId: PRODUCT }])
    expect(store.calls.some((sql) => /(?:into|from) category_default_products\b/.test(sql))).toBe(false)
    expect(store.released).toBe(5)
  })

  it("resolves override settings only for the requested project", async () => {
    const store = new MemoryDefaults()
    const override = { ...product, id: USER, sku: "SYN-OVERRIDE" }
    store.choices.set(`${A}:wall-switch:2`, { device_type_id: "wall-switch", button_count: 2, product_id: USER })
    const client = { query: async (sql: string, params: unknown[]) => sql.includes("from products") ? { rows: [product, override] } : store.query(sql, params) } as never
    const request = [{ deviceTypeId: "wall-switch", buttonCount: 2 }]
    expect((await loadCategoryDefaultProducts(client, A, request)).get("wall-switch:2")?.id).toBe(USER)
    expect((await loadCategoryDefaultProducts(client, B, request)).get("wall-switch:2")?.id).toBe(PRODUCT)
  })

  it("rejects anonymous requests and missing project identity", async () => {
    const store = new MemoryDefaults()
    await expect(listCategoryDefaultProducts(null, A, store.db())).rejects.toMatchObject({ status: 401 })
    await expect(setCategoryDefaultProduct(context(), { projectId: "", deviceTypeId: "wall-switch", productId: null }, store.db())).rejects.toMatchObject({ status: 404 })
    expect(store.calls).toEqual([])
  })

  it("rejects both reading and writing an invisible project without touching its defaults", async () => {
    const store = new MemoryDefaults()
    store.visible = false
    await expect(listCategoryDefaultProducts(context(), A, store.db())).rejects.toMatchObject({ status: 404 })
    await expect(setCategoryDefaultProduct(context(), { projectId: A, deviceTypeId: "wall-switch", productId: null }, store.db())).rejects.toMatchObject({ status: 404 })
    expect(store.calls).toContain("rollback")
    expect(store.calls.some((sql) => sql.includes("from project_category"))).toBe(false)
    expect(store.released).toBe(2)
  })

  it("does not allow a read-only project member to change defaults", async () => {
    const store = new MemoryDefaults()
    store.readOnly = true
    await expect(setCategoryDefaultProduct(context(true), { projectId: A, deviceTypeId: "wall-switch", productId: null }, store.db())).rejects.toMatchObject({ status: 403 })
    expect(store.choices.size).toBe(0)
  })
})
