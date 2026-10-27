#!/usr/bin/env node
/**
 * 生成「产品参数清单（按类别）」文档：docs/产品参数-按类别清单.md
 *
 * 规则的唯一来源是 lib/device-types.ts；这份文档是它的可读版本，用来对照整理产品。
 * 改了类型/参数定义后跑一次，文档就不会和代码脱节：
 *
 *   node scripts/build-product-specs-doc.mjs
 *
 * 有 DATABASE_URL（.env.local 或环境变量）时会顺带写上「你库里这类有多少条」，
 * 没有也能生成，只是不显示数量。
 */
import { readFileSync, writeFileSync } from "node:fs"

const { deviceTypes } = await import("../lib/device-types.ts")
const { STANDARD_PRODUCT_CATEGORIES } = await import("../lib/product-categories.ts")

async function loadCounts() {
  const url = process.env.DATABASE_URL || (() => {
    try {
      return readFileSync(".env.local", "utf8").split("\n").find((line) => line.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "")
    } catch { return "" }
  })()
  if (!url) return new Map()
  try {
    const { Client } = await import("pg")
    const client = new Client({ connectionString: url })
    await client.connect()
    const result = await client.query("select device_type_id, count(*)::int n from products where deleted_at is null group by 1")
    await client.end()
    return new Map(result.rows.map((row) => [row.device_type_id, row.n]))
  } catch {
    console.warn("（连不上数据库，本次不显示每类的产品条数）")
    return new Map()
  }
}

const counts = await loadCounts()
const lines = [
  "# 产品参数清单（按类别）",
  "",
  "> 由 `lib/device-types.ts` 自动生成（`node scripts/build-product-specs-doc.mjs`），是系统认的**法定规则**：",
  "> 参数名、类型、取值范围都在这里。整理产品时对照本表填写；填了参数就必须同时填 `设备类型ID`，否则无法校验。",
  "",
  "## 三种「需要」的区别（先看这个）",
  "",
  "| 层级 | 是什么 | 缺了会怎样 |",
  "| --- | --- | --- |",
  "| 导入必需 | 只要「系统货号」「产品名称」两列 | 记录进不来 |",
  "| **参数必填** | 每个设备类型标 🔴 的参数（共 96 个） | 这条产品在选型/报价里被标「产品缺少XX」，**用不上** |",
  "| **点位选型必需** ⭐ | 只有 7 个类型标了（共 16 个参数） | 做点位图时显示「点位XX待确认」 |",
  "| （非参数门槛）参数核验 | `参数核验状态`=已核验 且 有「参数依据」 | 产品一律显示「产品参数尚未核验」 |",
  "",
  "标注：🔴 = 必填，⭐ = 点位选型必需（可同时存在），⚪ = 选填。",
  "",
]

for (const category of STANDARD_PRODUCT_CATEGORIES) {
  const list = deviceTypes.filter((type) => type.category === category)
  if (!list.length) continue
  const total = list.reduce((sum, type) => sum + (counts.get(type.id) ?? 0), 0)
  lines.push(`## ${category}（${list.length} 种类型${counts.size ? `，你库里 ${total} 条` : ""}）`, "")
  for (const type of [...list].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))) {
    const count = counts.get(type.id)
    lines.push(`### ${type.name}　\`${type.id}\`${count === undefined ? "" : `　你库里 ${count} 条`}`, "")
    lines.push("| 参数 | 名称 | 类型 | 必填 | 取值 / 范围 | 单位 |", "| --- | --- | --- | --- | --- | --- |")
    for (const spec of type.specs ?? []) {
      const flag = [spec.required ? "🔴" : "", spec.requiredForPoint ? "⭐" : ""].filter(Boolean).join(" ") || "⚪"
      const kind = spec.type === "number" ? "数字" : spec.type === "boolean" ? "是/否" : "文字"
      const range = spec.values
        ? spec.values.map((value) => `\`${value}\``).join(" / ")
        : [spec.min !== undefined ? `≥${spec.min}` : "", spec.max !== undefined ? `≤${spec.max}` : ""].filter(Boolean).join(" ") || "—"
      lines.push(`| \`${spec.key}\` | ${spec.name} | ${kind} | ${flag} | ${range} | ${spec.unit ?? "—"} |`)
    }
    lines.push("")
  }
}

lines.push(
  "## 维护方式",
  "",
  "- 规则来自 `lib/device-types.ts`：要加类型、改必填、加枚举值，改代码并跑测试，不要在表格里自创参数名。",
  "- 参数写法：`名称=值`，多个用分号隔开，例如 `button_count=2;relay_count=1;wiring=neutral`。",
  "- 通信协议 / 设备能力同理，取值必须是代码里的枚举。",
  "- 本文档由脚本生成，别手工改；改规则后重跑脚本即可。",
)

writeFileSync("docs/产品参数-按类别清单.md", `${lines.join("\n")}\n`, "utf8")
console.log(`已生成 docs/产品参数-按类别清单.md（${lines.length} 行，${counts.size ? `附产品条数` : "无产品条数"}）`)
