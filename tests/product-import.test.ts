import { describe, expect, it, vi } from "vitest"

import { mapProduct, type AdminProduct, type ProductRow } from "../lib/product-admin-service"
import {
  buildImportTemplate,
  parseCsv,
  parseImportNumber,
  parseImportTable,
  planProductImport,
} from "../lib/product-import"
import { applyProductImport, buildMutationInput } from "../lib/product-import-service"

const row: ProductRow = {
  id: "20000000-0000-0000-0000-000000000001",
  name: "双键智能开关",
  sku: "FMKJ-SW-001",
  category: "开关",
  brand: "繁梦",
  platform: "米家",
  unit: "个",
  price: 199,
  cost: 120,
  stock: 10,
  image: "/assets/a.png",
  description: "原描述",
  tags: ["开关"],
  channels: ["线下"],
  status: "approved",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
  submitted_by: null,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  catalog_kind: "sku",
  device_type_id: "wall-switch",
  parent_product_id: null,
  manufacturer_model: "SW-2K-W",
  specs: { button_count: 2, relay_count: 1, wiring: "neutral" },
  protocols: ["zigbee"],
  capabilities: ["load-control"],
  selection_status: "verified",
  selection_evidence: "厂家说明书第 3 页",
  pricing_status: "verified",
  pricing_evidence: "渠道报价 2026-10-01",
  mapping_revision: 4,
}

const existing = () => mapProduct(row)
const HEADER = "系统货号,产品名称,售价,成本,库存,品牌"

describe("CSV 解析", () => {
  it("支持引号包裹、字段内逗号、双引号转义和 CRLF", () => {
    const rows = parseCsv('\uFEFFa,b\r\n"含,逗号","他说""好"""\r\n')
    expect(rows).toEqual([["a", "b"], ["含,逗号", '他说"好"']])
  })

  it("跳过完全空白的行", () => {
    expect(parseCsv("a,b\n\n,\n\nc,d")).toEqual([["a", "b"], ["c", "d"]])
  })

  it("金额允许货币符号和千分位，纯文字判为无效", () => {
    expect(parseImportNumber("¥1,299.00")).toBe(1299)
    expect(parseImportNumber("１９９")).toBeNull()
    expect(parseImportNumber("面议")).toBeNull()
  })
})

describe("表格预演", () => {
  it("缺必需表头时直接说清楚要重下模板", () => {
    const parsed = parseImportTable("品牌,类别\n繁梦,开关")
    expect(parsed.fileError).toMatch(/系统货号/)
    expect(parsed.records).toEqual([])
  })

  it("按系统货号判断新增、覆盖、不变", () => {
    const second = () => mapProduct({ ...row, id: "20000000-0000-0000-0000-000000000002", sku: "FMKJ-SW-002", name: "单键开关", price: 99 })
    const csv = [
      HEADER,
      "FMKJ-SW-001,双键智能开关,199,120,10,繁梦",        // 与库里完全一致 → 不变
      "FMKJ-SW-002,单键智能开关（白色）,129,120,10,繁梦",  // 改名改价 → 覆盖
      "FMKJ-SW-999,新开关,59,30,5,繁梦",                 // 库里没有 → 新增
    ].join("\n")
    const plan = planProductImport(parseImportTable(csv).records, [existing(), second()])

    expect(plan.summary).toMatchObject({ create: 1, unchanged: 1, update: 1, error: 0, total: 3 })
    expect(plan.rows[1].changes.map((change) => change.label)).toEqual(["产品名称", "售价"])
    expect(plan.rows[1].changes[1]).toMatchObject({ from: "99", to: "129" })
    expect(plan.rows[2].message).toMatch(/库里没有/)
  })

  it("同一个货号在一个文件里出现两次算错误：说不清哪一行才算数", () => {
    const csv = [HEADER, "FMKJ-SW-999,新开关,59,30,5,繁梦", "FMKJ-SW-999,又一遍,59,30,5,繁梦"].join("\n")
    const plan = planProductImport(parseImportTable(csv).records, [])

    expect(plan.summary).toMatchObject({ create: 1, error: 1 })
    expect(plan.rows[1].message).toMatch(/与第 2 行重复/)
  })

  it("缺名称、坏数字、未知设备类型、非整数库存在预演阶段指出来", () => {
    const csv = [
      "系统货号,产品名称,售价,库存,设备类型ID",
      "A-1,,100,1,wall-switch",
      "A-1,重复货号,100,1,wall-switch",
      "A-2,坏价格,面议,1,wall-switch",
      "A-3,坏类型,100,1,不存在-的类型",
      "A-4,坏库存,100,1.5,wall-switch",
    ].join("\n")
    const plan = planProductImport(parseImportTable(csv).records, [])

    expect(plan.summary.error).toBe(5)
    expect(plan.rows[0].message).toMatch(/产品名称不能为空/)
    expect(plan.rows[1].message).toMatch(/与第 2 行重复/)
    expect(plan.rows[2].message).toMatch(/售价：请填数字/)
    expect(plan.rows[3].message).toMatch(/不存在/)
    expect(plan.rows[4].message).toMatch(/必须是整数/)
  })

  it("不认识的列名被列出来而不是静默丢弃", () => {
    const parsed = parseImportTable("系统货号,产品名称,供应商\nA-1,开关,老王")
    expect(parsed.unknownHeaders).toEqual(["供应商"])
  })

  it("空单元格等于「这一项不改」，不会把库里的值抹掉", () => {
    const parsed = parseImportTable("系统货号,产品名称,售价,成本\nFMKJ-SW-001,双键智能开关,,120")
    const record = parsed.records[0]
    expect(record.errors).toEqual([])
    const changes = planProductImport([record], [existing()]).rows[0]
    expect(changes.action).toBe("unchanged")
  })
})

describe("请求体合成", () => {
  it("更新时用库里的完整记录补齐没写的列，价格不会被写成 0", () => {
    const parsed = parseImportTable("系统货号,产品名称,成本\nFMKJ-SW-001,双键智能开关,130")
    const input = buildMutationInput(parsed.records[0], existing())

    expect(input).toMatchObject({
      productId: row.id,
      price: 199,          // 表格没写售价，必须是原价而不是 0
      cost: 130,
      stock: 10,
      unit: "个",
      sku: "FMKJ-SW-001",
      tags: ["开关"],
    })
    // 没写的选型字段不能提交，否则会抹掉已核验的依据。
    expect(input).not.toHaveProperty("selectionEvidence")
    expect(input).not.toHaveProperty("deviceTypeId")
    expect(input).not.toHaveProperty("status")
  })

  it("新增时给默认单位与待审核状态，目录类型默认按旧记录处理", () => {
    const parsed = parseImportTable("系统货号,产品名称\nNEW-1,新开关")
    const input = buildMutationInput(parsed.records[0], null)

    expect(input).toMatchObject({ name: "新开关", sku: "NEW-1", unit: "个", price: 0, status: "pending_review", catalogKind: "legacy" })
    expect(input).not.toHaveProperty("productId")
  })
})

describe("落库", () => {
  const emptyTail = () => ({ ...existing(), sku: "NEW-1", name: "新开关", id: "id-new" })

  it("新增、更新、跳过、单行失败互不影响", async () => {
    const second = () => mapProduct({ ...row, id: "20000000-0000-0000-0000-000000000002", sku: "FMKJ-SW-002", name: "单键开关", price: 99 })
    const csv = [
      HEADER,
      "FMKJ-SW-001,双键智能开关,199,120,10,繁梦",        // 不变 → 跳过
      "FMKJ-SW-002,单键智能开关（新）,129,120,10,繁梦",   // 更新
      "NEW-1,新开关,59,30,5,繁梦",                      // 新增
      "BAD-1,,1,1,1,繁梦",                              // 行内错误
    ].join("\n")
    const create = vi.fn(async (_input: Record<string, unknown>) => emptyTail() as AdminProduct)
    const update = vi.fn(async (_input: Record<string, unknown>) => ({ ...second(), name: "单键智能开关（新）", price: 129 }) as AdminProduct)

    const result = await applyProductImport(csv, "actor-1", {
      create,
      list: async () => [existing(), second()],
      update,
    })

    expect(result).toMatchObject({ created: 1, updated: 1, skipped: 1, failed: 1 })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({
      actorUserId: "actor-1",
      productId: "20000000-0000-0000-0000-000000000002",
      price: 129,
      cost: 120,
    })
    expect(result.rows.find((entry) => entry.status === "failed")?.message).toMatch(/产品名称不能为空/)
  })

  it("写入服务报错时只记这一行失败，后面的行继续", async () => {
    const csv = [HEADER, "A-1,会失败,1,1,1,繁梦", "A-2,会成功,2,2,2,繁梦"].join("\n")
    const create = vi.fn(async (input: { sku: string }) => {
      if (input.sku === "A-1") throw Object.assign(new Error("VALIDATION_ERROR"), { details: { sku: "SKU 已存在" } })
      return { ...existing(), sku: input.sku, id: `id-${input.sku}` } as AdminProduct
    })

    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [], update: vi.fn() })

    expect(result).toMatchObject({ created: 1, failed: 1 })
    expect(result.rows[0].message).toBe("SKU 已存在")
    expect(result.rows[1].status).toBe("created")
  })

  it("整个文件级别的问题在落库阶段同样拦住", async () => {
    const result = await applyProductImport("品牌\n繁梦", "actor-1", { list: async () => [] })
    expect(result.fileError).toMatch(/系统货号/)
    expect(result.created).toBe(0)
  })

  it("「只补新品」策略下已有货号一律不覆盖，新货号照常新增", async () => {
    const csv = [HEADER, "FMKJ-SW-001,双键智能开关（被改过）,888,120,10,繁梦", "NEW-1,新开关,59,30,5,繁梦"].join("\n")
    const create = vi.fn(async (_input: Record<string, unknown>) => emptyTail() as AdminProduct)
    const update = vi.fn(async () => existing() as AdminProduct)

    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [existing()], update }, { existing: "skip" })

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 })
    expect(update).not.toHaveBeenCalled()
    expect(result.rows[0].message).toMatch(/只新增，不覆盖/)
  })
})

describe("模板", () => {
  it("表头是中文、带一行示例，且能被自己的解析器读回来", () => {
    const template = buildImportTemplate()
    expect(template.startsWith("系统货号,产品名称,")).toBe(true)

    const plan = planProductImport(parseImportTable(template).records, [])
    expect(plan.summary).toMatchObject({ total: 1, create: 1, error: 0 })
    expect(plan.rows[0].sku).toBe("FMKJ-SW-001")
  })
})

describe("结构化参数、协议与图片", () => {
  it("参数按 k=v 写，数字自动转成数值", async () => {
    const csv = "系统货号,产品名称,设备类型ID,参数\nSW-1,三键开关,wall-switch,button_count=3;relay_count=2;wiring=neutral"
    const record = parseImportTable(csv).records[0]

    expect(record.errors).toEqual([])
    expect(record.values.specs).toEqual({ button_count: 3, relay_count: 2, wiring: "neutral" })
  })

  it("参数缺设备类型或写法不对，都在预演阶段说清楚", () => {
    const noType = parseImportTable("系统货号,产品名称,参数\nA-1,开关,button_count=3").records[0]
    expect(noType.errors.join()).toMatch(/必须同时填设备类型ID/)

    const badPair = parseImportTable("系统货号,产品名称,设备类型ID,参数\nA-1,开关,wall-switch,三个键").records[0]
    expect(badPair.errors.join()).toMatch(/要写成 名称=值/)

    const wrongType = parseImportTable("系统货号,产品名称,设备类型ID,参数\nA-1,开关,wall-switch,button_count=三").records[0]
    expect(wrongType.errors.join()).toMatch(/应为数值/)
  })

  it("设备类型不支持的参数会被点出来", () => {
    const record = parseImportTable("系统货号,产品名称,设备类型ID,参数\nA-1,开关,wall-switch,screen_size_in=7").records[0]
    expect(record.errors.join()).toMatch(/不支持此参数/)
  })

  it("参数键顺序不同不算改动，重复导入仍然跳过", () => {
    const csv = "系统货号,产品名称,设备类型ID,参数\nFMKJ-SW-001,双键智能开关,wall-switch,relay_count=1;button_count=2;wiring=neutral"
    const plan = planProductImport(parseImportTable(csv).records, [mapProduct({ ...row, specs: { button_count: 2, relay_count: 1, wiring: "neutral" } })])
    expect(plan.rows[0].action).toBe("unchanged")
  })

  it("参数真的变了才报「覆盖」，并写进请求体", () => {
    const csv = "系统货号,产品名称,设备类型ID,参数\nFMKJ-SW-001,双键智能开关,wall-switch,button_count=4;relay_count=1;wiring=neutral"
    const record = parseImportTable(csv).records[0]
    const plan = planProductImport([record], [mapProduct({ ...row, specs: { button_count: 2, relay_count: 1, wiring: "neutral" } })])

    expect(plan.rows[0].action).toBe("update")
    expect(plan.rows[0].changes.map((change) => change.label)).toContain("参数")
    expect(buildMutationInput(record, mapProduct(row)).specs).toEqual({ button_count: 4, relay_count: 1, wiring: "neutral" })
  })

  it("协议与能力按分号拆开，图片地址原样带走", () => {
    const csv = "系统货号,产品名称,设备类型ID,通信协议,设备能力,图片地址\nA-1,开关,wall-switch,zigbee;wifi,load-control;dimming,/placeholder.svg"
    const record = parseImportTable(csv).records[0]

    expect(record.errors).toEqual([])
    expect(record.values.protocols).toEqual(["zigbee", "wifi"])
    expect(record.values.capabilities).toEqual(["load-control", "dimming"])
    expect(buildMutationInput(record, null)).toMatchObject({ image: "/placeholder.svg", protocols: ["zigbee", "wifi"] })
  })

  it("模板里带上了这四列，照模板填就能被读回来", () => {
    const header = buildImportTemplate().split("\r\n")[0]
    expect(header).toContain("参数")
    expect(header).toContain("通信协议")
    expect(header).toContain("设备能力")
    expect(header).toContain("图片地址")
  })
})

describe("资料里的图片", () => {
  const csv = "系统货号,产品名称,图片地址\nNEW-IMG,带图的开关,/placeholder.svg"

  it("取到图片就把地址换成本地可读的 /api/files/ 地址", async () => {
    const resolveAsset = vi.fn(async () => "/api/files/product-images/official/a.png")
    const create = vi.fn(async (_input: Record<string, unknown>) => ({ ...existing(), sku: "NEW-IMG", name: "带图的开关" }) as AdminProduct)

    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [], update: vi.fn() }, { resolveAsset })

    expect(result).toMatchObject({ created: 1, failed: 0 })
    expect(create.mock.calls[0][0]).toMatchObject({ image: "/api/files/product-images/official/a.png" })
    expect(resolveAsset).toHaveBeenCalledWith("/placeholder.svg", null)
  })

  it("图片这次没取到：保留原地址并明确说明，不让整行失败", async () => {
    const resolveAsset = vi.fn(async () => null)
    const create = vi.fn(async (_input: Record<string, unknown>) => ({ ...existing(), sku: "NEW-IMG" }) as AdminProduct)

    const result = await applyProductImport(csv, "actor-1", { create, list: async () => [], update: vi.fn() }, { resolveAsset })

    expect(result).toMatchObject({ created: 1, failed: 0 })
    expect(create.mock.calls[0][0]).toMatchObject({ image: "/placeholder.svg" })
    expect(result.rows[0].message).toMatch(/图片这次没取到/)
  })

  it("本地已经有这张图（文件确实在）就不再重复下载", async () => {
    const resolveAsset = vi.fn(async () => "不该被调用")
    const local = mapProduct({ ...row, sku: "NEW-IMG", image: "/api/files/product-images/official/a.png" })
    const update = vi.fn(async (_input: Record<string, unknown>) => local as AdminProduct)

    await applyProductImport(
      "系统货号,产品名称,图片地址\nNEW-IMG,双键智能开关,/placeholder.svg",
      "actor-1",
      { create: vi.fn(), list: async () => [local], update, localFileExists: async () => true },
      { resolveAsset },
    )

    expect(resolveAsset).not.toHaveBeenCalled()
  })

  /**
   * 这个 bug 曾经真实发生过：图片地址没变 → 整行被当成「和库里一样」跳过 →
   * 首次同步没取完的图（有每次上限）永远补不上，客户那边一直破图。
   * 现在先确认「文件到底在不在」，不在就重新取。
   */
  it("本地地址还在、但文件已经不在了：重新取回来（不再被当成没变化跳过）", async () => {
    const resolveAsset = vi.fn(async () => "/api/files/product-images/official/repaired.png")
    const local = mapProduct({ ...row, sku: "NEW-IMG", image: "/api/files/product-images/official/missing.png" })
    const update = vi.fn(async (_input: Record<string, unknown>) => local as AdminProduct)

    const result = await applyProductImport(
      "系统货号,产品名称,图片地址\nNEW-IMG,双键智能开关,/placeholder.svg",
      "actor-1",
      { create: vi.fn(), list: async () => [local], update, localFileExists: async () => false },
      { resolveAsset },
    )

    expect(resolveAsset).toHaveBeenCalledTimes(1)
    expect(result.failed).toBe(0)
  })
})
