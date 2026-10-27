import { describe, expect, it, vi } from "vitest"

import { generateKeyPairSync } from "node:crypto"
import {
  buildCatalogCsv,
  stripCostColumn,
  catalogRevision,
  catalogSyncConfig,
  catalogSyncReady,
  fetchCatalogSnapshot,
  sha256Hex,
  signCatalogCsv,
  snapshotUrl,
  verifyCatalogSignature,
} from "../lib/catalog-sync"
import { applyCatalogSync, applyExistingPolicy, catalogSyncNotReady, createAssetResolver, getCatalogSyncStatus, previewCatalogSync } from "../lib/catalog-sync-service"
import { planSyncSchedule, resetCatalogSyncSchedule, startCatalogSyncSchedule } from "../lib/catalog-sync-schedule"
import { mapProduct, type ProductRow } from "../lib/product-admin-service"
import { parseImportTable, planProductImport } from "../lib/product-import"

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
  image: null,
  description: "官方描述",
  tags: ["开关", "白色"],
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
  specs: {},
  protocols: [],
  capabilities: [],
  selection_status: "pending",
  selection_evidence: "",
  pricing_status: "pending",
  pricing_evidence: "",
  mapping_revision: 1,
}

const CONFIGURED = {
  UPSTREAM_ENABLED: "true",
  UPSTREAM_BASE_URL: "https://official.example.com/",
  LICENSE_KEY: "lic-123",
  INSTANCE_ID: "inst-abc",
}

function textResponse(body: string, headers: Record<string, string> = {}, status = 200) {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response
}

describe("同步配置", () => {
  it("三个变量齐了才算配好，地址末尾的斜杠会被去掉", () => {
    const config = catalogSyncConfig(CONFIGURED)
    expect(config).toMatchObject({ baseUrl: "https://official.example.com", enabled: true, licenseKey: "lic-123" })
    expect(catalogSyncReady(config)).toBe(true)
    expect(snapshotUrl(config)).toBe("https://official.example.com/api/catalog/snapshot")
  })

  it("没开启、缺地址、缺凭据分别给出各自的提示", () => {
    expect(catalogSyncNotReady(catalogSyncConfig({}))).toMatch(/UPSTREAM_ENABLED/)
    expect(catalogSyncNotReady(catalogSyncConfig({ ...CONFIGURED, UPSTREAM_BASE_URL: "" }))).toMatch(/UPSTREAM_BASE_URL/)
    expect(catalogSyncNotReady(catalogSyncConfig({ ...CONFIGURED, LICENSE_KEY: "" }))).toMatch(/LICENSE_KEY/)
    expect(catalogSyncReady(catalogSyncConfig({ ...CONFIGURED, UPSTREAM_ENABLED: "false" }))).toBe(false)
  })
})

describe("拉取资料快照", () => {
  it("带上凭据和实例标识，并把摘要与版本头读出来", async () => {
    const csv = "系统货号,产品名称\nA-1,开关\n"
    const fetchImpl = vi.fn(async () => textResponse(csv, { "x-catalog-revision": "rev-9", "x-catalog-sha256": sha256Hex(csv) }))

    const snapshot = await fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), { fetch: fetchImpl as unknown as typeof fetch })

    expect(snapshot).toEqual({ csv, revision: "rev-9", signature: "unsigned" })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://official.example.com/api/catalog/snapshot")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer lic-123")
    expect((init.headers as Record<string, string>)["x-instance-id"]).toBe("inst-abc")
  })

  it("摘要对不上就拒绝，不把半份资料应用进去", async () => {
    const fetchImpl = async () => textResponse("系统货号,产品名称\nA-1,被改过\n", { "x-catalog-sha256": sha256Hex("另一份内容") })

    await expect(fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), { fetch: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/摘要对不上/)
  })

  it("凭据失效说清楚是凭据问题，且不影响本地继续用", async () => {
    const fetchImpl = async () => textResponse("", {}, 401)

    await expect(fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), { fetch: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/凭据无效或已过期/)
  })

  it("连不上时带上底层原因，方便设备上排障", async () => {
    const fetchImpl = async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }) }

    await expect(fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), { fetch: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/ENOTFOUND/)
  })

  it("没有摘要头时仍接受，用内容自己算版本", async () => {
    const csv = "系统货号,产品名称\nA-1,开关\n"
    const snapshot = await fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), {
      fetch: (async () => textResponse(csv)) as unknown as typeof fetch,
    })
    expect(snapshot.revision).toBe(catalogRevision(csv))
  })
})

describe("发布端导出", () => {
  it("导出的 CSV 能被设备侧的解析器原样读回来", () => {
    const csv = buildCatalogCsv([mapProduct(row)])
    const parsed = parseImportTable(csv)

    expect(parsed.fileError).toBeNull()
    expect(parsed.unknownHeaders).toEqual([])
    expect(planProductImport(parsed.records, []).rows[0]).toMatchObject({ sku: "FMKJ-SW-001", action: "create" })
    // 成本价不下发：运营方的进货价不该出现在经销商设备上（用户 2026-10-22 的要求）。
    expect(parsed.records[0].values).not.toHaveProperty("cost", 120)
    expect(parsed.records[0].values).toMatchObject({
      price: 199,
      brand: "繁梦",
      deviceTypeId: "wall-switch",
      tags: ["开关", "白色"],
      channels: ["线下"],
    })
  })

  it("图片、参数、协议会一起导出：设备拿到的不是一列空值", () => {
    const csv = buildCatalogCsv([mapProduct({
      ...row,
      image: "/placeholder.svg",
      specs: { button_count: 2, relay_count: 1, wiring: "neutral" },
      protocols: ["zigbee"],
      capabilities: ["load-control"],
    })])
    const record = parseImportTable(csv).records[0]

    expect(record.errors).toEqual([])
    expect(record.values.image).toBe("/placeholder.svg")
    expect(record.values.specs).toEqual({ button_count: 2, relay_count: 1, wiring: "neutral" })
    expect(record.values.protocols).toEqual(["zigbee"])
    expect(record.values.capabilities).toEqual(["load-control"])
  })

  it("导出后立刻按同一份内容回灌，结果是「什么都没变」", () => {
    // 成本价不下发，所以这条用没有成本的原始行来验「回灌无变化」；
    // 「有成本的行回灌会只看到成本一处差异」另有一条用例覆盖。
    const noCost = { ...row, cost: null }
    const csv = buildCatalogCsv([mapProduct(noCost)])
    const plan = planProductImport(parseImportTable(csv).records, [mapProduct(noCost)])

    expect(plan.summary).toMatchObject({ create: 0, update: 0, unchanged: 1, error: 0 })
  })

  it("成本列不下发，也不会把设备上已有的成本抹掉", () => {
    // 导出时成本是空值，而导入的规则是「表格里没写的字段不覆盖」，
    // 所以经销商自己在设备上填的进价不会被官方同步清掉。
    const csv = buildCatalogCsv([mapProduct(row)])
    const plan = planProductImport(parseImportTable(csv).records, [mapProduct(row)])

    expect(plan.summary).toMatchObject({ create: 0, update: 0, unchanged: 1, error: 0 })
  })

  it("上游若仍带成本列，设备侧也会抹掉（双保险）", () => {
    const csv = buildCatalogCsv([mapProduct(row)])
    // 伪造一份旧版主站的资料：把成本列填回去
    const header = csv.split("\n")[0].split(",")
    const costIndex = header.indexOf("成本")
    const rows = csv.split("\n").map((line, index) => {
      if (index === 0) return line
      const cells = line.split(",")
      cells[costIndex] = "999"
      return cells.join(",")
    })
    const tampered = rows.join("\n")
    expect(parseImportTable(tampered).records[0].values.cost).toBe(999)

    expect(parseImportTable(stripCostColumn(tampered)).records[0].values.cost).toBeUndefined()
  })
})

describe("同步服务", () => {
  const db = (rows: Record<string, unknown>[] = []) => ({ query: vi.fn(async () => ({ rows })) })

  it("没配置好时预演不联网，只说明缺什么", async () => {
    const fetchImpl = vi.fn()
    const preview = await previewCatalogSync({ env: {}, fetch: fetchImpl as unknown as typeof fetch })

    expect(preview.preview).toBeNull()
    expect(preview.message).toMatch(/UPSTREAM_ENABLED/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("预演把拉到的资料交给导入通道，不写库", async () => {
    const csv = "系统货号,产品名称,售价\nA-1,开关,10\n"
    const applySpy = vi.fn()
    const preview = await previewCatalogSync({
      env: CONFIGURED,
      fetch: (async () => textResponse(csv, { "x-catalog-revision": "rev-1" })) as unknown as typeof fetch,
      preview: (async (text: string) => {
        expect(text).toBe(csv)
        return { fileError: null, rows: [], summary: { create: 1, error: 0, total: 1, unchanged: 0, update: 0 }, unknownHeaders: [] }
      }) as never,
      apply: applySpy as never,
    })

    expect(preview.revision).toBe("rev-1")
    expect(preview.preview?.summary.create).toBe(1)
    expect(applySpy).not.toHaveBeenCalled()
  })

  it("应用成功后记一条运行记录（版本、计数、操作人）", async () => {
    const database = db()
    const csv = "系统货号,产品名称\nA-1,开关\n"
    const applied = await applyCatalogSync("user-1", {
      env: CONFIGURED,
      db: database as never,
      fetch: (async () => textResponse(csv, { "x-catalog-revision": "rev-2" })) as unknown as typeof fetch,
      apply: (async () => ({ created: 1, updated: 0, skipped: 0, failed: 0, fileError: null, rows: [] })) as never,
    })

    expect(applied).toMatchObject({ revision: "rev-2" })
    expect(applied.result).toMatchObject({ created: 1 })
    const [sql, params] = database.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/insert into catalog_sync_runs/)
    expect(params.slice(0, 6)).toEqual(["rev-2", "succeeded", 1, 0, 0, 0])
    expect(params[7]).toBe("user-1")
  })

  it("拉取失败时抛错，但留下一條失败记录供页面显示", async () => {
    const database = db()
    const failing = async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }) }

    await expect(applyCatalogSync("user-1", {
      env: CONFIGURED,
      db: database as never,
      fetch: failing as unknown as typeof fetch,
    })).rejects.toThrow(/ECONNREFUSED/)

    const [, params] = database.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(params[1]).toBe("failed")
    expect(String(params[6])).toMatch(/ECONNREFUSED/)
  })

  /**
   * 规则 B（用户 2026-10-23 定）：官方同步更新「官方字段」，不动客户自己的价格/库存/标签/渠道/描述。
   * 实现是把这些列置空（导入工具的约定：空单元格 = 不改这一项），所以同步统一走 update。
   */
  it("同步只更新官方字段：客户自己的价格/库存/标签/渠道/描述一律置空，其余照常更新", async () => {
    const csv = [
      "系统货号,产品名称,售价,库存,标签,渠道,描述,参数,系列,图片地址",
      "A-1,开关,199,10,热销,线下,官方描述,power=ac-mains,T1,/placeholder.svg",
    ].join("\n")
    const apply = vi.fn(async (_csv: string, _actor: string, _deps: unknown, _options: unknown) => (
      { created: 0, updated: 1, skipped: 0, failed: 0, fileError: null, rows: [] }
    ))

    await applyCatalogSync("user-1", {
      env: CONFIGURED,
      db: db() as never,
      fetch: (async () => textResponse(csv)) as unknown as typeof fetch,
      apply: apply as never,
    })

    // 1) 策略是 update（老设备的已有产品也能拿到官方修复）
    expect(apply.mock.calls[0][3]).toMatchObject({ existing: "update" })
    // 2) 客户自己的字段被置空 = 不改；官方字段原样保留
    const sent = String(apply.mock.calls[0][0])
    const [header, row] = sent.split("\n")
    const cells = header.split(",").map((name, index) => [name.trim(), row.split(",")[index] ?? ""])
    const value = (name: string) => cells.find(([key]) => key === name)?.[1] ?? ""
    expect(value("售价")).toBe("")
    expect(value("库存")).toBe("")
    expect(value("标签")).toBe("")
    expect(value("渠道")).toBe("")
    expect(value("描述")).toBe("")
    expect(value("参数")).toBe("power=ac-mains")
    expect(value("系列")).toBe("T1")
    expect(value("图片地址")).toBe("/placeholder.svg")
  })


  it("定时同步没有操作人：以 null 传下去，不编造一个假用户去顶审计", async () => {
    const csv = "系统货号,产品名称\nA-1,开关\n"
    const apply = vi.fn(async (_csv: string, _actor: string | null, _deps: unknown, _options: unknown) => ({
      created: 1, updated: 0, skipped: 0, failed: 0, fileError: null, rows: [],
    }))

    await applyCatalogSync(null, {
      env: CONFIGURED,
      db: db() as never,
      fetch: (async () => textResponse(csv)) as unknown as typeof fetch,
      apply: apply as never,
    })

    expect(apply.mock.calls[0][1]).toBeNull()
  })

  it("预演按同一策略显示：默认时已有货号显示为「不覆盖」，勾选后恢复为「覆盖」", () => {
    const raw = {
      fileError: null,
      rows: [{ action: "update" as const, changes: [{ from: "1", label: "售价", to: "2" }], line: 2, message: "会覆盖 1 项", name: "开关", productId: "id-1", sku: "A-1" }],
      summary: { create: 0, error: 0, total: 1, unchanged: 0, update: 1 },
      unknownHeaders: [] as string[],
    }

    const kept = applyExistingPolicy(raw, false)
    expect(kept.summary).toMatchObject({ update: 0, unchanged: 1 })
    expect(kept.rows[0]).toMatchObject({ action: "unchanged", changes: [] })
    expect(kept.rows[0].message).toMatch(/本次不覆盖/)

    expect(applyExistingPolicy(raw, true)).toBe(raw)
  })

  it("状态查询读出上次同步，数据库还没迁移时显示「没有记录」而不是报错", async () => {
    const database = db([{
      revision: "rev-3",
      status: "partial",
      created_count: 2,
      updated_count: 1,
      skipped_count: 5,
      failed_count: 1,
      message: "第 3 行设备类型不存在",
      started_at: "2026-10-22T00:00:00Z",
      finished_at: "2026-10-22T00:00:05Z",
    }])
    const status = await getCatalogSyncStatus({ env: CONFIGURED, db: database as never })

    expect(status).toMatchObject({
      configured: true,
      baseUrl: "https://official.example.com",
      lastRun: { revision: "rev-3", status: "partial", created: 2, updated: 1, skipped: 5, failed: 1 },
    })

    const broken = await getCatalogSyncStatus({
      env: CONFIGURED,
      db: { query: async () => { throw new Error("relation \"catalog_sync_runs\" does not exist") } } as never,
    })
    expect(broken.lastRun).toBeNull()
    expect(broken.configured).toBe(true)
  })
})

describe("定时同步排期", () => {
  const scheduleEnv = { UPSTREAM_ENABLED: "true", UPSTREAM_BASE_URL: "https://official.example.com", LICENSE_KEY: "lic" }

  it("没配官方资料就不排期，什么也不做", () => {
    expect(planSyncSchedule({})).toBeNull()
    expect(planSyncSchedule({ ...scheduleEnv, UPSTREAM_ENABLED: "false" })).toBeNull()
    expect(startCatalogSyncSchedule({ env: {} })).toBe(false)
  })

  it("配好之后默认每 24 小时一次、启动 5 分钟后先跑一次", () => {
    expect(planSyncSchedule(scheduleEnv)).toEqual({ intervalMs: 24 * 3600_000, startupDelayMs: 5 * 60_000 })
  })

  it("可以调间隔，也能整个关掉定时（只留手动）", () => {
    expect(planSyncSchedule({ ...scheduleEnv, UPSTREAM_SYNC_INTERVAL_HOURS: "6", UPSTREAM_SYNC_STARTUP_DELAY_MINUTES: "0" }))
      .toEqual({ intervalMs: 6 * 3600_000, startupDelayMs: 0 })
    expect(planSyncSchedule({ ...scheduleEnv, UPSTREAM_SYNC_INTERVAL_HOURS: "abc" }))
      .toMatchObject({ intervalMs: 24 * 3600_000 })
    expect(planSyncSchedule({ ...scheduleEnv, UPSTREAM_SYNC_ENABLED: "false" })).toBeNull()
  })

  it("到点会真的去同步，而且用的是「只补新品」策略；失败只记日志不影响应用", async () => {
    resetCatalogSyncSchedule()
    const timers: Array<{ handler: () => void; ms: number }> = []
    const apply = vi.fn(async (_actor: string, _deps: unknown, _options: unknown) => ({
      message: "", result: { created: 2, updated: 0, skipped: 1, failed: 0, fileError: null, rows: [] }, revision: "r",
    }))
    const logs: string[] = []

    const started = startCatalogSyncSchedule({
      apply: apply as never,
      env: scheduleEnv,
      log: (message) => logs.push(message),
      setInterval: ((handler: () => void, ms: number) => { timers.push({ handler, ms }); return 1 }) as never,
      setTimeout: ((handler: () => void, ms: number) => { timers.push({ handler, ms }); return 1 }) as never,
    })

    expect(started).toBe(true)
    expect(timers.map((timer) => timer.ms)).toEqual([5 * 60_000, 24 * 3600_000])

    for (const timer of timers) timer.handler()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply.mock.calls[0][2]).toEqual({ updateExisting: false })
    expect(logs.join("\n")).toMatch(/新增 2/)

    resetCatalogSyncSchedule()
    const failing = startCatalogSyncSchedule({
      apply: (async () => { throw new Error("ENOTFOUND") }) as never,
      env: scheduleEnv,
      log: (message) => logs.push(message),
      setInterval: ((handler: () => void) => { timers.push({ handler, ms: 0 }); return 1 }) as never,
      setTimeout: (() => 1) as never,
    })
    expect(failing).toBe(true)
    timers[timers.length - 1].handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(logs.join("\n")).toMatch(/ENOTFOUND/)
    resetCatalogSyncSchedule()
  })

  it("重复注册只排一次，避免开发模式热重载排出一堆定时器", () => {
    resetCatalogSyncSchedule()
    const noop = (() => 1) as never
    const deps = { apply: (async () => ({ created: 0, updated: 0, skipped: 0, failed: 0, fileError: null, rows: [], revision: "" })) as never, env: scheduleEnv, log: () => {}, setInterval: noop, setTimeout: noop }
    expect(startCatalogSyncSchedule(deps)).toBe(true)
    expect(startCatalogSyncSchedule(deps)).toBe(false)
    resetCatalogSyncSchedule()
  })
})

describe("资料签名（Ed25519）", () => {
  const pair = generateKeyPairSync("ed25519")
  const privatePem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  const publicPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  const csv = "系统货号,产品名称\nA-1,开关\n"

  it("签过的资料能验过，改一个字就验不过", () => {
    const signature = signCatalogCsv(csv, privatePem)
    expect(verifyCatalogSignature(csv, signature, publicPem)).toBe(true)
    expect(verifyCatalogSignature(`${csv}B-2,改过\n`, signature, publicPem)).toBe(false)
    expect(verifyCatalogSignature(csv, "不是签名", publicPem)).toBe(false)
    expect(verifyCatalogSignature(csv, signature, "不是公钥")).toBe(false)
  })

  it("配了公钥：签名正确才标记 verified", async () => {
    const signature = signCatalogCsv(csv, privatePem)
    const snapshot = await fetchCatalogSnapshot(
      catalogSyncConfig({ ...CONFIGURED, UPSTREAM_PUBLIC_KEY: publicPem }),
      { fetch: (async () => textResponse(csv, { "x-catalog-signature": signature })) as unknown as typeof fetch },
    )
    expect(snapshot.signature).toBe("verified")
  })

  it("配了公钥但资料没签名/签名不对：一律拒收", async () => {
    await expect(fetchCatalogSnapshot(
      catalogSyncConfig({ ...CONFIGURED, UPSTREAM_PUBLIC_KEY: publicPem }),
      { fetch: (async () => textResponse(csv)) as unknown as typeof fetch },
    )).rejects.toThrow(/没有签名/)

    await expect(fetchCatalogSnapshot(
      catalogSyncConfig({ ...CONFIGURED, UPSTREAM_PUBLIC_KEY: publicPem }),
      { fetch: (async () => textResponse(csv, { "x-catalog-signature": "伪造" })) as unknown as typeof fetch },
    )).rejects.toThrow(/签名校验不通过/)
  })

  it("显式允许无签名时才接受，并标记为 unsigned", async () => {
    const snapshot = await fetchCatalogSnapshot(
      catalogSyncConfig({ ...CONFIGURED, UPSTREAM_PUBLIC_KEY: publicPem, UPSTREAM_ALLOW_UNSIGNED: "true" }),
      { fetch: (async () => textResponse(csv)) as unknown as typeof fetch },
    )
    expect(snapshot.signature).toBe("unsigned")
  })

  it("没配公钥时不验签，标记 unsigned（只保证传输完整）", async () => {
    const snapshot = await fetchCatalogSnapshot(catalogSyncConfig(CONFIGURED), {
      fetch: (async () => textResponse(csv, { "x-catalog-sha256": sha256Hex(csv) })) as unknown as typeof fetch,
    })
    expect(snapshot.signature).toBe("unsigned")
  })
})

describe("官方图片取回", () => {
  const png = Buffer.from("89504e470d0a1a0a0000", "hex")

  it("取到就存进本地存储，返回本地地址", async () => {
    const save = vi.fn(async () => ({ url: "/api/files/product-images/official/a.png" }))
    const resolver = createAssetResolver(catalogSyncConfig(CONFIGURED), {
      fetch: (async () => ({ ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => png })) as unknown as typeof fetch,
      save,
    })

    expect(await resolver.resolve("/placeholder.svg")).toBe("/api/files/product-images/official/a.png")
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ contentType: "image/png", filename: "a.png", kind: "product-images" }))
  })

  it("下载失败返回 null 并记下来，下次同步会再试", async () => {
    const resolver = createAssetResolver(catalogSyncConfig(CONFIGURED), {
      fetch: (async () => ({ ok: false, status: 404, headers: { get: () => null } })) as unknown as typeof fetch,
      save: vi.fn(),
    })

    expect(await resolver.resolve("/placeholder.svg")).toBeNull()
    expect(resolver.failed()).toEqual(["/placeholder.svg"])
  })

  it("超出本次预算就不再下载，避免一次同步拉上千张图", async () => {
    const save = vi.fn(async () => ({ url: "/api/files/x.png" }))
    const fetchImpl = (async () => ({ ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => png })) as unknown as typeof fetch
    const resolver = createAssetResolver(catalogSyncConfig(CONFIGURED), { budget: 2, fetch: fetchImpl, save })

    expect(await resolver.resolve("/assets/a.png")).toBeTruthy()
    expect(await resolver.resolve("/assets/b.png")).toBeTruthy()
    expect(await resolver.resolve("/assets/c.png")).toBeNull()
    expect(resolver.used()).toBe(2)
    expect(save).toHaveBeenCalledTimes(2)
  })
})
