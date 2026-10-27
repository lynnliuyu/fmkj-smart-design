import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({ list: vi.fn(), requireSuperAdmin: vi.fn() }))

vi.mock("@/lib/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/admin-auth")>()
  return { ...actual, requireSuperAdmin: deps.requireSuperAdmin }
})
// 只替换产品列表，其它导出（错误映射要用）保持原样，否则 adminApiErrorResponse 会找不到函数。
vi.mock("@/lib/product-admin-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/product-admin-service")>()
  return { ...actual, listAdminProducts: deps.list }
})

import { GET } from "../app/api/admin/products/export/route"
import { IMPORT_COLUMNS } from "../lib/product-import"

function product(overrides: Record<string, unknown> = {}) {
  return {
    brand: "繁梦",
    capabilities: ["load-control"],
    catalogKind: "sku",
    category: "开关",
    channels: ["线下"],
    cost: 120,
    description: "",
    deviceTypeId: "wall-switch",
    id: "10000000-0000-0000-0000-000000000001",
    image: "/placeholder.svg",
    manufacturerModel: "SW-2K-W",
    name: "双键智能开关",
    platform: "米家",
    price: 199,
    pricingEvidence: "",
    pricingStatus: "pending",
    protocols: ["zigbee"],
    selectionEvidence: "",
    selectionStatus: "pending",
    sku: "FMKJ-SW-001",
    specs: { button_count: 2 },
    stock: 50,
    tags: ["开关", "白色"],
    unit: "个",
    ...overrides,
  }
}

describe("导出产品表格", () => {
  beforeEach(() => {
    deps.list.mockReset()
    deps.requireSuperAdmin.mockReset()
    deps.requireSuperAdmin.mockResolvedValue({ user: { role: "admin", userId: "u1" } })
    deps.list.mockResolvedValue([product()])
  })

  it("导出的表头和「批量导入」用的是同一套列", async () => {
    const response = await GET()
    const text = await response.text()
    const [header] = text.replace(/^\uFEFF/, "").split("\r\n")

    expect(header.split(",")).toEqual(IMPORT_COLUMNS.map((column) => column.label))
  })

  it("导出的表能被 Excel 正确打开：带 BOM、CRLF 换行、有下载文件名", async () => {
    const response = await GET()
    // Response.text() 会把 BOM 吃掉，所以要验原始字节。
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = await new Response(bytes).text()

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(text.includes("\r\n")).toBe(true)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("product-library.csv")
  })

  it("成本列留空：这份表是发给经销商的，不带自己的进货价", async () => {
    const response = await GET()
    const text = (await response.text()).replace(/^\uFEFF/, "")
    const [header, row] = text.trim().split("\r\n")
    const cells = row.split(",")
    const costIndex = header.split(",").indexOf("成本")

    expect(costIndex).toBeGreaterThan(-1)
    expect(cells[costIndex]).toBe("")
    expect(text).not.toContain("120")
  })

  it("没权限就不给导", async () => {
    deps.requireSuperAdmin.mockRejectedValue(new Error("UNAUTHORIZED"))

    // 接口把鉴权失败转成错误响应（不是把文件发出去）。
    const result = await GET().catch((error: unknown) => error)
    if (result instanceof Response) {
      expect(result.status).toBeGreaterThanOrEqual(400)
      expect(result.headers.get("content-disposition")).toBeNull()
    } else {
      expect(String(result)).toContain("UNAUTHORIZED")
    }
    // 不应该真的去查产品库
    expect(deps.list).not.toHaveBeenCalled()
  })
})
