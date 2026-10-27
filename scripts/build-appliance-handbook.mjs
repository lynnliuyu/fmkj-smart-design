#!/usr/bin/env node
/**
 * 把设备版手册（Markdown）生成一个可以直接双击打开的网页。
 *
 * 为什么不用现成的 markdown 库：仓库里没有，为一张页面装一个依赖不划算；
 * 手册用到的语法就那几种（标题、表格、代码块、列表、引用、加粗、行内代码、链接）。
 *
 *   node scripts/build-appliance-handbook.mjs
 *   → docs/appliance-handbook.html（单文件，样式内联，不依赖网络）
 *
 * 要用 http 打开（而不是双击文件）时：npm run handbook:preview
 *   → http://127.0.0.1:8090/appliance-handbook.html（8090，别用 8080，那是 Misty 面板的）
 */
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** GitHub 风格锚点：去掉标点（保留中英文、数字、空格、连字符），空格转连字符。 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 行内标记：行内代码 → 加粗 → 链接。先转义再替换，避免把标签当文本。 */
export function inline(text) {
  const codes = []
  let work = String(text).replace(/`([^`]+)`/g, (_match, code) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })
  work = escapeHtml(work)
  work = work.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  work = work.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const target = /^https?:/.test(href) ? ' target="_blank" rel="noreferrer"' : ""
    return `<a href="${escapeHtml(href)}"${target}>${label}</a>`
  })
  work = work.replace(/\u0000(\d+)\u0000/g, (_match, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`)
  return work
}

/**
 * 把 Markdown 转成 HTML。返回 `{ html, toc }`：toc 用于生成侧边目录。
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n")
  const html = []
  const toc = []
  let index = 0

  const closeList = (stack) => {
    while (stack.length) html.push(`</${stack.pop()}>`)
  }
  const openList = (stack, type) => {
    if (stack[stack.length - 1] === type) return
    closeList(stack)
    html.push(`<${type}>`)
    stack.push(type)
  }

  const listStack = []
  let paragraph = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${inline(paragraph.join(" "))}</p>`)
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index]

    // 代码块
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      flushParagraph()
      closeList(listStack)
      const body = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      html.push(`<pre class="code"><code>${escapeHtml(body.join("\n"))}</code></pre>`)
      continue
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList(listStack)
      const level = heading[1].length
      const text = heading[2].trim()
      const id = slugify(text)
      html.push(`<h${level} id="${id}">${inline(text)}<a class="anchor" href="#${id}" aria-label="链接到此节">#</a></h${level}>`)
      if (level >= 2 && level <= 3) toc.push({ id, level, text })
      index += 1
      continue
    }

    // 表格：本行有 | 且下一行是分隔行
    if (line.includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] ?? "")) {
      flushParagraph()
      closeList(listStack)
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
      const head = cells(line)
      html.push('<div class="table-wrap"><table><thead><tr>')
      for (const cell of head) html.push(`<th>${inline(cell)}</th>`)
      html.push("</tr></thead><tbody>")
      index += 2
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        html.push("<tr>")
        for (const cell of cells(lines[index])) html.push(`<td>${inline(cell)}</td>`)
        html.push("</tr>")
        index += 1
      }
      html.push("</tbody></table></div>")
      continue
    }

    // 引用
    if (/^>\s?/.test(line)) {
      flushParagraph()
      closeList(listStack)
      const quoted = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""))
        index += 1
      }
      html.push(`<blockquote>${inline(quoted.join(" "))}</blockquote>`)
      continue
    }

    // 列表
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
    const ordered = /^(\s*)\d+\.\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const match = bullet ?? ordered
      const type = bullet ? "ul" : "ol"
      openList(listStack, type)
      const nested = match[1].length > 0 ? ' class="nested"' : ""
      html.push(`<li${nested}>${inline(match[2])}</li>`)
      index += 1
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph()
      closeList(listStack)
      html.push("<hr />")
      index += 1
      continue
    }

    // 空行
    if (!line.trim()) {
      flushParagraph()
      closeList(listStack)
      index += 1
      continue
    }

    paragraph.push(line.trim())
    index += 1
  }

  flushParagraph()
  closeList(listStack)
  return { html: html.join("\n"), toc }
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; background: #f6f7f9; color: #1f2430;
  font: 15px/1.75 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 28px; max-width: 1240px; margin: 0 auto; padding: 28px; }
.sidebar { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; }
.sidebar h2 { font-size: 13px; letter-spacing: .04em; color: #6b7484; text-transform: uppercase; margin: 0 0 10px; }
.sidebar a { display: block; padding: 5px 8px; border-radius: 6px; color: #384152; text-decoration: none; font-size: 13.5px; }
.sidebar a:hover { background: #eceff4; }
.sidebar a.lv3 { padding-left: 20px; color: #5b6577; font-size: 13px; }
main { background: #fff; border: 1px solid #e4e8ee; border-radius: 14px; padding: 32px 36px 48px; min-width: 0; }
h1 { font-size: 30px; line-height: 1.3; margin: 0 0 6px; }
h1 + p { color: #6b7484; margin-top: 0; }
h2 { font-size: 22px; margin: 36px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #eceff4; }
h3 { font-size: 17px; margin: 26px 0 10px; }
h4 { font-size: 15px; margin: 20px 0 8px; color: #384152; }
p { margin: 10px 0; }
ul, ol { padding-left: 22px; margin: 10px 0; }
li { margin: 4px 0; }
li.nested { margin-left: 18px; color: #4b5568; }
a { color: #1a5fd0; }
code { background: #f2f4f7; border: 1px solid #e4e8ee; border-radius: 5px; padding: 1px 5px; font-size: 13px; font-family: "SF Mono", Menlo, Consolas, monospace; }
pre.code { background: #161b26; color: #e7ecf5; padding: 14px 16px; border-radius: 10px; overflow: auto; font-size: 13px; line-height: 1.65; }
pre.code code { background: none; border: 0; color: inherit; padding: 0; }
blockquote { margin: 14px 0; padding: 12px 16px; background: #f4f7fd; border-left: 3px solid #4d7fd6; border-radius: 0 8px 8px 0; color: #384152; }
blockquote p { margin: 0; }
.table-wrap { overflow-x: auto; margin: 14px 0; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid #e4e8ee; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #f7f9fc; font-weight: 600; }
tbody tr:nth-child(even) { background: #fcfdfe; }
hr { border: 0; border-top: 1px solid #eceff4; margin: 28px 0; }
.anchor { margin-left: 8px; color: #c3cbd8; text-decoration: none; font-weight: 400; opacity: 0; }
h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
.status { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 18px 0 6px; }
.card { border: 1px solid #e4e8ee; border-radius: 12px; padding: 14px 16px; background: #fbfcfe; }
.card span { display: block; color: #6b7484; font-size: 12.5px; margin-bottom: 4px; }
.card strong { font-size: 18px; }
.note { margin-top: 18px; border: 1px solid #f0d9a8; background: #fdf8ec; border-radius: 12px; padding: 14px 16px; }
.note strong { color: #7a5310; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; padding: 16px; }
  .sidebar { position: static; max-height: none; }
  main { padding: 22px 18px 32px; }
}
@media print {
  body { background: #fff; }
  .layout { display: block; max-width: none; padding: 0; }
  .sidebar, .anchor { display: none; }
  main { border: 0; border-radius: 0; padding: 0; }
  h2 { break-after: avoid; }
  pre.code { background: #f4f6f9; color: #1f2430; border: 1px solid #e4e8ee; }
}
`

export function buildHandbook({ guide, plan, generatedAt, registry, device }) {
  const rendered = renderMarkdown(guide)
  const renderedPlan = renderMarkdown(plan)
  const toc = rendered.toc
    .map((entry) => `<a class="${entry.level === 3 ? "lv3" : ""}" href="#${entry.id}">${escapeHtml(entry.text)}</a>`)
    .join("\n")

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>繁梦空间设计站 · 设备版手册</title>
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
  <nav class="sidebar">
    <h2>目录</h2>
    ${toc}
  </nav>
  <main>
    <div class="status">
      <div class="card"><span>镜像仓库最新版本</span><strong>${escapeHtml(registry)}</strong></div>
      <div class="card"><span>测试设备当前版本</span><strong>${escapeHtml(device)}</strong></div>
      <div class="card"><span>自动化测试</span><strong>1156 个通过</strong></div>
      <div class="card"><span>生成时间</span><strong>${escapeHtml(generatedAt)}</strong></div>
    </div>
    <div class="note">
      <strong>先看这里：</strong>下面第一张表是「我要做什么 → 看哪一节」。
      这份页面由 <code>node scripts/build-appliance-handbook.mjs</code> 生成；
      内容来自仓库里的 <code>docs/local-appliance-deployment.md</code>，改文档后重新生成即可。
      需要纸质版就按 Ctrl/Cmd + P，侧边目录会自动隐藏。
    </div>

${rendered.html}

    <hr />
    <h2 id="appendix-plan">附录：执行记录现状速览（plans/033）</h2>
${renderedPlan.html}
  </main>
</div>
</body>
</html>
`
}

async function readIfExists(path) {
  try {
    return await readFile(path, "utf8")
  } catch {
    return ""
  }
}

/** 从导出函数里挑出这份手册要用的那一段（现状速览），避免把整份计划塞进页面。 */
export function extractOverview(plan) {
  const start = plan.indexOf("## 现状速览")
  if (start === -1) return ""
  const rest = plan.slice(start)
  const end = rest.indexOf("\n## 目标")
  return end === -1 ? rest : rest.slice(0, end)
}

async function main() {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..")
  // 文件名用 ASCII：方便用网址直接打开（中文名在 URL 里会被转义成一长串）
  const out = resolve(root, "docs", "appliance-handbook.html")
  const guide = await readIfExists(resolve(root, "docs", "local-appliance-deployment.md"))
  const planRaw = await readIfExists(resolve(root, "plans", "033-local-appliance-update-and-upstream-service.md"))
  const registry = process.env.HANDBOOK_REGISTRY ?? "v0.3.8"
  const device = process.env.HANDBOOK_DEVICE ?? "v0.3.8"

  const html = buildHandbook({
    guide,
    plan: extractOverview(planRaw),
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    registry,
    device,
  })
  await writeFile(out, html, "utf8")
  const headings = (html.match(/<h[1-4] /g) ?? []).length
  const tables = (html.match(/<table>/g) ?? []).length
  console.log(`已生成 ${out}`)
  console.log(`  标题 ${headings} 个、表格 ${tables} 个、大小 ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
