#!/usr/bin/env node
/**
 * 产品库整理：把「旧资料待整理」的产品补成可用于选型的规范 SKU。
 *
 *   node scripts/curate-product-library.mjs --products <导出的产品.json> --source <依据.csv> --out <整理结果.csv> [--report <报告.md>]
 *
 * 依据（用户提供）：
 *   - 产品整理汇总.xlsx：型号、规格选项（淘宝/京东商品页抓取，含功率、色温、光束角、显色指数等）
 *   - 产品库表格.xlsx：品牌、SKU、分类、平台、价格
 *
 * 原则：
 *   1. 只做**能从现有信息推出来**的填充（品名、货号、设备类型、规格选项），推不出来的一律留空。
 *   2. 每个推断都写进「参数依据」并标注「推断，待核验」——不冒充厂家资料核验过的数据。
 *   3. 空单元格 = 不改这一项（导入工具的约定），所以不碰没把握的字段。
 */
import { readFileSync, writeFileSync } from "node:fs"

import { deviceTypes, validateDeviceSpecs } from "../lib/device-types.ts"

const args = process.argv.slice(2)
const arg = (name, fallback = "") => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const products = JSON.parse(readFileSync(arg("--products"), "utf8")).products
const sourceRows = readCsv(readFileSync(arg("--source"), "utf8").replace(/^\uFEFF/, ""))
const outPath = arg("--out", "/tmp/curated.csv")
// 表头直接用「导出表格」导出来的表头：它由导入模板生成，永远不会和导入对不上。
const templateHeader = readCsvLine(readFileSync(arg("--template"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)[0])
const reportPath = arg("--report", "/tmp/curation-report.md")

const typeById = new Map(deviceTypes.map((type) => [type.id, type]))
const PLATFORM_LABELS = { mijia: "米家", homekit: "Apple Home", huawei: "华为", tuya: "Tuya", knx: "KNX", alexa: "Amazon Alexa", "google-home": "Google Home", unlabeled: "未标注" }
const specKeysOf = (typeId) => new Set((typeById.get(typeId)?.specs ?? []).map((spec) => spec.key))

// ── 依据表索引：库里的名字是清洗过的，依据表是「商品名+规格选项」原样拼的，
//    所以按字符 3-gram 重叠度做模糊匹配（重合同品牌只做粗筛，最后靠相似度定行）。
const PROMO = /(先采后付|官方物流|7天无理由|退货包运费|限时免费|包安装|官方正品|现货|批发)/g
const norm = (text) => String(text ?? "").replace(/[\s【】\[\]（）()，,。、·\-—_/：:]/g, "")
function grams(text, size = 3) {
  const set = new Set()
  for (let i = 0; i + size <= text.length; i += 1) set.add(text.slice(i, i + size))
  return set
}
function similarity(a, b) {
  if (!a.length || !b.length) return 0
  const [small, large] = a.length <= b.length ? [a, b] : [b, a]
  const big = grams(large)
  let hit = 0
  for (const gram of grams(small)) if (big.has(gram)) hit += 1
  return hit / grams(small).size
}
const sourceIndex = sourceRows
  .map((row) => ({ row, name: norm(String(row["产品名称"] ?? "").replace(PROMO, "")) }))
  .filter((entry) => entry.name.length >= 6)
function findSource(productName) {
  const name = norm(String(productName ?? "").replace(PROMO, ""))
  let best = null
  for (const entry of sourceIndex) {
    const score = similarity(name, entry.name)
    if (score >= 0.42 && (!best || score > best.score)) best = { score, row: entry.row }
  }
  return best ? best.row : null
}
// ── 供电方式：按设备类型给默认，品名里的关键词优先
const BATTERY_TYPES = new Set(["motion-sensor", "presence-sensor", "door-sensor", "water-sensor", "temp-humidity-sensor", "smoke-sensor", "gas-sensor", "illuminance-sensor", "scene-panel", "smart-button", "remote-control", "doorbell", "door-lock", "curtain-remote", "wireless-switch"])
const DC_TYPES = new Set(["light-strip", "camera", "smart-speaker"])
function inferPower(product) {
  const name = `${product.name} ${product.manufacturerModel ?? ""}`
  if (/PoE|POE/.test(name)) return "poe"
  if (/电池|无线|免布线/.test(name) && BATTERY_TYPES.has(product.deviceTypeId)) return "battery"
  if (product.deviceTypeId === "light-strip" || /24V|12V/.test(name)) return "dc"
  if (BATTERY_TYPES.has(product.deviceTypeId)) return "battery"
  if (DC_TYPES.has(product.deviceTypeId)) return "dc"
  if (typeById.has(product.deviceTypeId ?? "")) return "ac-mains"
  return null
}

// ── 从品名/规格选项里抠参数
function inferSpecs(product, sourceOption = "") {
  const text = `${product.name ?? ""} ${sourceOption ?? ""}`
  const typeId = product.deviceTypeId
  const allowed = specKeysOf(typeId)
  const found = {}
  const set = (key, value) => { if (allowed.has(key) && value !== null && value !== undefined) found[key] = value }

  const buttons = /四键|4键/.test(text) ? 4 : /三键|3键/.test(text) ? 3 : /双键|两键|2键/.test(text) ? 2 : /单键|1键/.test(text) ? 1 : null
  if (buttons) set("button_count", buttons)
  if (/零火/.test(text)) set("wiring", "neutral")
  else if (/单火/.test(text)) set("wiring", "no-neutral")

  const watts = text.match(/(\d{1,3}(?:\.\d)?)\s*[Ww](?![a-zA-Z])/)
  if (watts) set("power_w", Number(watts[1]))
  const kelvin = text.match(/(\d{4})\s*[Kk](?![a-zA-Z])/)
  if (kelvin) set("color_temp_k", Number(kelvin[1]))
  const cri = text.match(/Ra\s*(\d{2,3})|显色指数\s*(\d{2,3})/i)
  if (cri) set("cri", Number(cri[1] ?? cri[2]))
  const beam = text.match(/(\d{1,3})\s*°/)
  if (beam) set("beam_angle_deg", Number(beam[1]))
  const cutout = text.match(/开孔\s*(\d{2,3})\s*(?:mm)?(?!\s*[-~/])/)
  if (cutout) set("cutout_mm", Number(cutout[1]))
  const length = text.match(/(\d+(?:\.\d+)?)\s*米|(\d{2,4})\s*mm\s*长/)
  if (length && allowed.has("strip_length_m")) set("strip_length_m", Number(length[1] ?? Number(length[2]) / 1000))

  if (/全光谱/.test(text)) set("spectrum", "full-spectrum")
  else if (/RGB\s*\+?\s*CCT|RGBWC|RGB\+CCT/i.test(text)) set("spectrum", "rgb-cct")
  else if (/RGB/.test(text)) set("spectrum", "rgb")
  else if (/双色温/.test(text)) set("spectrum", "dual-cct")
  else if (/单色温/.test(text)) set("spectrum", "single-cct")

  if (/无极调光|无级调光/.test(text)) set("dimming", "stepless")
  else if (/DALI/i.test(text)) set("dimming", "dali")
  else if (/0-10V/i.test(text)) set("dimming", "0-10v")
  else if (/可控硅/.test(text)) set("dimming", "triac")
  else if (/分段调光/.test(text)) set("dimming", "segmented")
  else if (/不可调光/.test(text)) set("dimming", "none")

  if (/内置驱动/.test(text)) set("driver", "built-in")
  else if (/外置驱动/.test(text)) set("driver", "external")
  else if (/需配驱动|另配驱动/.test(text)) set("driver", "required-separately")

  if (/嵌入式|开孔/.test(text)) set("installation", "embedded")
  else if (/吸顶/.test(text)) set("installation", "ceiling")
  else if (/磁吸轨道|轨道灯/.test(text)) set("installation", "track")
  else if (/86型|86盒/.test(text)) set("installation", "86-box")
  else if (/桌面|台面/.test(text)) set("installation", "desktop")
  else if (/壁挂|贴墙|墙壁/.test(text)) set("installation", "wall")

  const colors = [[/白色|经典白/, "white"], [/灰色|深灰|浅灰/, "gray"], [/黑色|曜黑|午夜/, "black"], [/金色|香槟金/, "gold"], [/银色/, "silver"], [/米色|奶咖|可可蛋奶|春雨|奶油/, "beige"]]
  for (const [pattern, value] of colors) if (pattern.test(text)) { set("color", value); break }
  return found
}

// ── 设备类型：品名关键词兜底（只给高置信的）
const TYPE_HINTS = [
  [/窗帘电机|开合帘电机|管状电机/, "curtain-motor"], [/窗帘/, "curtain-motor"],
  [/筒灯/, "downlight"], [/射灯/, "spotlight"], [/灯带|灯条/, "light-strip"], [/吸顶灯/, "ceiling-light"],
  [/轨道灯/, "track-light"], [/平板灯/, "panel-light"], [/格栅灯/, "grille-light"], [/风扇灯/, "fan-light"],
  [/青空灯|蓝天灯/, "sky-light"], [/屏幕挂灯|显示器挂灯/, "desk-light"], [/灯泡/, "smart-bulb"], [/吊灯/, "pendant-light"], [/壁灯/, "wall-light"],
  [/墙壁插座|智能插座|插座/, "socket"], [/墙壁开关|智能开关/, "wall-switch"], [/无线开关|场景开关/, "scene-panel"],
  [/存在传感器/, "presence-sensor"], [/人体传感器|移动传感器/, "motion-sensor"], [/门磁|门窗传感器/, "door-sensor"],
  [/温湿度/, "temp-humidity-sensor"], [/水浸/, "water-sensor"], [/烟雾/, "smoke-sensor"], [/燃气/, "gas-sensor"],
  [/照度/, "illuminance-sensor"], [/网关/, "gateway"], [/中控|主机/, "central-control"], [/面板|妙控屏|智能屏/, "touch-control-panel"],
  [/门锁/, "door-lock"], [/门铃/, "doorbell"], [/摄像机|摄像头/, "camera"], [/音箱/, "smart-speaker"],
  [/AP|接入点|交换机|路由器/, "wifi-ap"], [/地暖|温控|新风|空调/, "hvac-controller"],
]

// ── 厂家型号：从品名/规格选项里抠大写型号代码
function inferModel(product, sourceModel = "") {
  if (product.manufacturerModel) return product.manufacturerModel
  const text = `${product.name ?? ""} ${sourceModel ?? ""}`
  const patterns = [/[A-Z]{2,}[-/][A-Za-z0-9][A-Za-z0-9./-]{3,}/, /\b[A-Z]{3,}\d{2,}[A-Z]{0,4}\b/, /\b[A-Z]{2}\d{2,}[A-Z]{2,}\b/]
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit && !/^(LED|USB|WIFI|POE|RGB|APP|TYPE|PRO|MAX|MINI|PLUS)$/i.test(hit[0])) return hit[0]
  }
  return null
}

// ── 系列：中文名里「产品类型词 + 型号代号」的写法（D1/H1/L1/T2/G6/L3…）
function inferSeries(product, sourceModel = "") {
  if (product.series) return product.series
  const name = String(product.name ?? "")
  const hit = name.match(/([A-Z]{1,2}\d{1,3}(?:\s?Pro\+?|\s?Plus|\s?Mini)?)(?=[（(]|\s|$)/)
  if (hit) return hit[1].trim()
  const fromSource = String(sourceModel ?? "").trim()
  if (fromSource && /[\u4e00-\u9fa5A-Za-z]/.test(fromSource) && fromSource.length <= 20 && !/^\d+$/.test(fromSource)) return fromSource
  return null
}

// ── 逐条整理
const rows = []
const stats = { promoted: 0, typeInferred: 0, powerFilled: 0, specsFilled: 0, modelFilled: 0, modelSkipped: 0, seriesFilled: 0, matchedSource: 0, skippedEvidenced: 0, requiredFilledEvidenced: 0, requiredKeysFilled: [], bundleSkipped: 0, untouched: 0 }
for (const product of products) {
  const source = findSource(product.name)
  if (source) stats.matchedSource += 1
  const option = source?.["规格选项"] ?? ""
  const sourceModel = source?.["型号"] ?? ""

  const changes = {}
  // 套餐/组合装（「1室1厅 客厅灯*1+主卧*1」这类）不是单个产品，不升级为具体货号：
  // 它们没有唯一设备类型，进了选型只会变成噪音（实测 62 条被服务端正确拦下）。
  const isBundle = /\d+室\d*厅|套餐|组合装|\*\d/.test(String(product.name ?? ""))
  if (isBundle) stats.bundleSkipped += 1
  else if (product.catalogKind !== "sku" && product.catalogKind !== "series") { changes.catalogKind = "sku"; stats.promoted += 1 }
  let deviceTypeId = product.deviceTypeId
  if (!deviceTypeId || !typeById.has(deviceTypeId)) {
    const hit = TYPE_HINTS.find(([pattern]) => pattern.test(String(product.name ?? "")))
    if (hit) { deviceTypeId = hit[1]; changes.deviceTypeId = hit[1]; stats.typeInferred += 1 }
  }

  const target = { ...product, deviceTypeId }
  const specs = { ...(product.specs ?? {}) }
  const inferredKeys = []
  // 已经用官网资料整理过的产品（有真实依据）：不猜参数、不覆盖依据。
  // 上一轮整理者明确写过「官网未标注，按规范留空不猜填」，我这里再猜就是往回退。
  const hasRealEvidence = Boolean((product.selectionEvidence ?? "").trim())
  let evidenceNote = ""
  if (hasRealEvidence) {
    // 已有官网依据：**只补「必填但空着」的参数**，而且值必须能从品名/商品规格选项里读出来。
    // 官方页没写的项目（例如「继电器路数官网未标注」）用市场资料补上，并在依据里注明来源与「待复核」，
    // 原依据一字不改——不覆盖、不假装是官网数据。
    const requiredKeys = new Set((typeById.get(deviceTypeId)?.specs ?? []).filter((spec) => spec.required).map((spec) => spec.key))
    const candidates = { ...inferSpecs(target, option) }
    if (specKeysOf(deviceTypeId).has("power") && !specs.power) {
      const power = inferPower(target)
      if (power) candidates.power = power
    }
    const requiredFilled = []
    for (const [key, value] of Object.entries(candidates)) {
      if (!requiredKeys.has(key)) continue
      if (specs[key] !== undefined && specs[key] !== null && specs[key] !== "") continue
      specs[key] = value
      requiredFilled.push(key)
    }
    if (requiredFilled.length) {
      changes.specs = specs
      stats.requiredFilledEvidenced += 1
      stats.requiredKeysFilled.push(...requiredFilled)
      evidenceNote = `2026-10-23 补 ${[...new Set(requiredFilled)].join("、")}：取自该商品的品名/规格选项（市场资料），待厂家资料复核`
    }
    stats.skippedEvidenced += 1
  } else {
    const inferred = inferSpecs(target, option)
    // 供电方式只能填给「设备类型确实定义了该参数」的产品（墙壁开关这类靠接线方式区分，不填）。
    if (!specs.power && specKeysOf(deviceTypeId).has("power")) {
      const power = inferPower(target)
      if (power) { specs.power = power; inferredKeys.push("供电方式"); stats.powerFilled += 1 }
    }
    for (const [key, value] of Object.entries(inferred)) {
      if (specs[key] === undefined || specs[key] === null || specs[key] === "") { specs[key] = value; inferredKeys.push(key) }
    }
    if (inferredKeys.length) { changes.specs = specs; stats.specsFilled += 1 }
  }

  const model = inferModel(target, sourceModel)
  // 有真实依据时，只认品名/货号里白纸黑字出现过的型号；市场抓来的型号不加（会在报告里计数）。
  const modelTrusted = !hasRealEvidence || (model && `${product.name} ${product.sku}`.includes(model))
  if (model && model !== product.manufacturerModel && modelTrusted) { changes.manufacturerModel = model; stats.modelFilled += 1 }
  else if (model && model !== product.manufacturerModel) stats.modelSkipped += 1
  const series = inferSeries({ ...product, manufacturerModel: model }, sourceModel)
  if (series && series !== product.series) { changes.series = series; stats.seriesFilled += 1 }

  const validation = validateDeviceSpecs(deviceTypeId ?? "", specs)
  // 依据：原本为空 → 写我的推断说明；原本有官网依据 → 原文保留，只追加一句补了什么。
  const evidence = inferredKeys.length && !hasRealEvidence
    ? `2026-10-23 整理：${[...new Set(inferredKeys)].join("、")} 由品名/规格选项推断，待厂家资料核验`
    : evidenceNote
      ? `${(product.selectionEvidence ?? "").trim()}；${evidenceNote}`
      : ""

  rows.push({ product, changes, specs, deviceTypeId, evidence, option, sourceModel, validation,
    series: changes.series ?? product.series ?? null,
    manufacturerModel: changes.manufacturerModel ?? product.manufacturerModel ?? null })
  if (!Object.keys(changes).length) stats.untouched += 1
}

// ── 输出导入表（列顺序与导入模板一致，只填要改的格子）
const header = templateHeader
const lines = [header.join(",")]
for (const row of rows) {
  const { product, changes, specs, deviceTypeId, evidence } = row
  const values = new Array(header.length).fill("")
  const put = (label, value) => { const index = header.indexOf(label); if (index >= 0 && value !== undefined && value !== null) values[index] = String(value) }
  put("系统货号", product.sku)
  put("产品名称", product.name)
  put("品牌", product.brand ?? "")
  put("生态平台", (product.platforms?.length ? product.platforms : product.platform ? [product.platform] : []).map((value) => PLATFORM_LABELS[value] ?? value).join(";"))
  put("产品大类", product.category ?? "")
  put("设备类型ID", deviceTypeId ?? "")
  put("参数", Object.entries(specs).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => `${key}=${typeof value === "boolean" ? value : value}`).join(";"))
  put("通信协议", (product.protocols ?? []).join(";"))
  put("设备能力", (product.capabilities ?? []).join(";"))
  put("图片地址", product.image ?? "")
  put("厂家型号", changes.manufacturerModel ?? product.manufacturerModel ?? "")
  put("系列", changes.series ?? product.series ?? "")
  put("目录类型", changes.catalogKind ?? product.catalogKind ?? "")
  put("单位", product.unit ?? "")
  put("售价", product.price ?? "")
  put("库存", product.stock ?? "")
  put("标签", (product.tags ?? []).join(";"))
  put("渠道", (product.channels ?? []).join(";"))
  put("描述", product.description ?? "")
  put("参数依据", evidence || product.selectionEvidence || "")
  lines.push(values.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(","))
}
writeFileSync(outPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8")

const invalid = rows.filter((row) => row.validation.errors.length)
const report = [
  "# 产品库整理报告（2026-10-23）",
  "",
  `- 处理产品：**${rows.length}** 条`,
  `- 目录类型升级 legacy → sku：**${stats.promoted}** 条`,
  `- 套餐/组合装不升级（不是单个产品）：**${stats.bundleSkipped}** 条`,
  `- 设备类型推断补齐：**${stats.typeInferred}** 条`,
  `- 供电方式补齐：**${stats.powerFilled}** 条`,
  `- 其它参数补齐：**${stats.specsFilled}** 条`,
  `- 厂家型号补齐：**${stats.modelFilled}** 条（另有 ${stats.modelSkipped} 条因为只有市场抓来的型号、没有出现在品名/货号里，按不猜原则跳过）`,
  `- 已有官网依据的产品里，按「只补必填、注明来源、不动原文」补齐的：**${stats.requiredFilledEvidenced}** 条`,
  `  - 补的项目：${[...new Set(stats.requiredKeysFilled)].join("、") || "—"}`,
  `- 系列补齐：**${stats.seriesFilled}** 条`,
  `- 在依据表里找到对应行：**${stats.matchedSource}** 条`,
  `- 参数校验有报错的：**${invalid.length}** 条`,
  `- 完全没有改动：**${stats.untouched}** 条`,
  "",
  "推断出来的参数都写了「参数依据：由品名/规格选项推断，待厂家资料核验」，不代表已核对厂家资料。",
].join("\n")
writeFileSync(reportPath, report, "utf8")

// 字典补充 SQL：整理出来的品牌/系列/型号必须先进入字典，否则严格校验会拦下这些行。
const dictPath = arg("--dict-sql")
if (dictPath) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
  const brands = [...new Set(rows.map((row) => (row.product.brand ?? "").trim()).filter(Boolean))]
  const series = [...new Set(rows.filter((row) => row.series).map((row) => `${row.product.brand}\u0000${row.series}`))]
  const models = [...new Set(rows.filter((row) => row.manufacturerModel).map((row) => `${row.product.brand}\u0000${row.manufacturerModel}`))]
  const sql = ["-- 整理产品库时出现的品牌/系列/型号，补进受控字典（由 scripts/curate-product-library.mjs 生成）"]
  for (const brand of brands) sql.push(`insert into product_brands (name) values (${quote(brand)}) on conflict (name) do nothing;`)
  for (const item of series) { const [brand, name] = item.split("\u0000"); sql.push(`insert into product_series (brand_id, name) select id, ${quote(name)} from product_brands where name = ${quote(brand)} on conflict (brand_id, name) do nothing;`) }
  for (const item of models) { const [brand, name] = item.split("\u0000"); sql.push(`insert into product_models (brand_id, name) select id, ${quote(name)} from product_brands where name = ${quote(brand)} on conflict (brand_id, name) do nothing;`) }
  writeFileSync(dictPath, sql.join("\n") + "\n", "utf8")
  console.log(`\n字典补充 SQL：${dictPath}（品牌 ${brands.length} / 系列 ${series.length} / 型号 ${models.length}）`)
}
console.log(report)
console.log(`\n整理结果：${outPath}`)
if (invalid.length) {
  console.log("\n参数仍有问题的样本（前 5）：")
  for (const row of invalid.slice(0, 5)) console.log(`  · ${row.product.sku}：${row.validation.errors.slice(0, 2).join("；")}`)
}

function readCsv(text) {
  const rows = []
  let row = [], cell = "", quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(cell); cell = "" }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = "" }
    else if (ch !== "\r") cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const header = rows.shift() ?? []
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ""])))
}

function readCsvLine(line) {
  const cells = []
  let cell = "", quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { cells.push(cell); cell = "" }
    else cell += ch
  }
  cells.push(cell)
  return cells
}
