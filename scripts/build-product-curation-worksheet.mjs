#!/usr/bin/env node
/**
 * 把「导出的产品表」变成「整理清单」：每行预填现有值，并自动标出这一行缺什么。
 *
 *   node scripts/build-product-curation-worksheet.mjs --input product-library.csv --out 整理清单.csv
 *   # 只出 legacy（旧产品未整理）的那部分：
 *   node scripts/build-product-curation-worksheet.mjs --input product-library.csv --out legacy.csv --only-legacy
 *
 * 底稿就是「产品库 → 导出表格」导出来的 CSV（23 列，与导入同格式），
 * 所以在清单里改完可以原样导回去；只在末尾多两列提示（缺什么 / 建议做法），导入时会当作未知列忽略。
 */
import { readFileSync, writeFileSync } from "node:fs"

const { deviceTypes, missingRequiredDeviceSpecs, validateDeviceSpecs } = await import("../lib/device-types.ts")
const byType = new Map(deviceTypes.map((type) => [type.id, type]))

const args = process.argv.slice(2)
const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : "" }
const input = get("--input")
const out = get("--out")
const onlyLegacy = args.includes("--only-legacy")
if (!input || !out) {
  console.error("用法：node scripts/build-product-curation-worksheet.mjs --input <导出的产品表.csv> --out <整理清单.csv> [--only-legacy]")
  process.exit(1)
}

/** 极简 CSV 解析（支持引号与转义）。 */
function parseCsv(text) {
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
  return rows
}
const esc = (value) => {
  const text = String(value ?? "")
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const raw = readFileSync(input, "utf8").replace(/^\uFEFF/, "")
const [header, ...rows] = parseCsv(raw)
const col = (name) => header.indexOf(name)
const iSku = col("系统货号"), iName = col("产品名称"), iKind = col("目录类型"), iType = col("设备类型ID")
const iModel = col("厂家型号"), iImage = col("图片地址"), iSpecs = col("参数")

const outRows = []
let legacyCount = 0
for (const row of rows) {
  if (!row.length || !row[iSku]) continue
  const kind = (row[iKind] ?? "").trim()
  if (onlyLegacy && kind !== "legacy") continue
  if (kind === "legacy") legacyCount += 1

  const typeId = (row[iType] ?? "").trim()
  const typeDefs = new Map((byType.get(typeId)?.specs ?? []).map((spec) => [spec.key, spec]))
  const specs = {}
  for (const pair of (row[iSpecs] ?? "").split(";")) {
    const [key, ...rest] = pair.split("=")
    if (!key || !rest.length) continue
    const name = key.trim()
    const text = rest.join("=").trim()
    // CSV 里读出来都是文字，但数字/布尔参数必须按类型还原，否则校验会误判「应为数值」。
    const def = typeDefs.get(name)
    if (def?.type === "number" && text !== "" && Number.isFinite(Number(text))) specs[name] = Number(text)
    else if (def?.type === "boolean" && (text === "true" || text === "false")) specs[name] = text === "true"
    else specs[name] = text
  }

  const todo = []
  if (!typeId) todo.push("缺设备类型")
  else {
    for (const key of ["color", "material", "rated_voltage_v"]) {
      const def = byType.get(typeId)?.specs.find((spec) => spec.key === key)
      if (def && specs[key] === undefined) todo.push(`缺${def.name}`)
    }
    const normalized = validateDeviceSpecs(typeId, specs)
    todo.push(...missingRequiredDeviceSpecs(typeId, normalized.specs).map((name) => `缺${name}`))
    if (normalized.errors.length) todo.push(...normalized.errors.map((reason) => `参数无效：${reason}`))
  }
  if (kind === "legacy") todo.push("目录类型待升级（legacy→sku 或 series）")
  if (!(row[iModel] ?? "").trim()) todo.push("型号空")
  if (!(row[iImage] ?? "").trim()) todo.push("图片空")

  outRows.push({
    row,
    todo,
    hint: kind === "legacy"
      ? (row[iType] ? "改成 sku；如果它是某个系列的主记录就改成 series" : "先补设备类型，再改成 sku")
      : "",
    missing: todo.length,
  })
}

outRows.sort((a, b) => b.missing - a.missing || String(a.row[iSku]).localeCompare(String(b.row[iSku])))
const header2 = [...header, "缺什么", "建议做法"]
const body = [header2, ...outRows.map(({ row, todo, hint }) => [...row, todo.join("；"), hint])]
writeFileSync(out, `\uFEFF${body.map((line) => line.map(esc).join(",")).join("\r\n")}\r\n`, "utf8")
console.log(`已生成 ${out}：${outRows.length} 行${onlyLegacy ? "（仅 legacy）" : ""}；其中 legacy ${legacyCount} 行、有问题 ${outRows.filter((item) => item.missing).length} 行`)
