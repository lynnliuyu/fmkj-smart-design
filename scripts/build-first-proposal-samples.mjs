/** Render the production proposal component with clearly fictional data. No database access. */
import { createServer as createHttpServer } from "node:http"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "output/pdf/first-proposals")
const port = Number(process.env.FIRST_PROPOSAL_PREVIEW_PORT || 8795)
if (!Number.isInteger(port) || port < 8790 || port > 8799) throw new Error("FIRST_PROPOSAL_PREVIEW_PORT must be an available port in 8790-8799")
const runtimeModules = process.env.CODEX_WORKSPACE_NODE_MODULES || "/Users/you/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
const { chromium } = await import(path.join(runtimeModules, "playwright-core/index.mjs"))
const sampleThemes = [
  ["warm", "温暖雅居"],
  ["atelier", "深色高定"],
  ["nature", "自然疗愈"],
  ["gallery", "光影艺廊"],
]
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true }, resolve: { alias: { "@": root } }, ssr: { external: ["react", "react-dom", "react-dom/server"] } })
let browser, server
try {
  await mkdir(output, { recursive: true })
  const { FirstProposalDocument } = await vite.ssrLoadModule("/components/projects/first-proposal-document.tsx")
  const React = await import("react")
  const { renderToStaticMarkup } = await import("react-dom/server")
  const css = await readFile(path.join(root, "components/projects/first-proposal-document.css"), "utf8")
  const globals = (await readFile(path.join(root, "app/globals.css"), "utf8")).replace(/^@import[^;]+;\s*/gm, "")
  const definitions = [
    ["智能中控屏", "玄关", "中控与交互", 1, "台", 1899, "/placeholder.svg"],
    ["智能门锁", "玄关", "入户控制", 1, "套", 2499, "/placeholder.svg"],
    ["智能开关", "客餐厅", "灯光控制", 4, "个", 219, "/placeholder.svg"],
    ["窗帘电机", "客餐厅", "窗帘控制", 2, "台", 699, "/placeholder.svg"],
    ["人体存在传感器", "客餐厅", "感应控制", 1, "个", 299, "/placeholder.svg"],
    ["智能开关", "主卧", "灯光控制", 3, "个", 219, "/placeholder.svg"],
    ["窗帘电机", "主卧", "窗帘控制", 2, "台", 699, "/placeholder.svg"],
    ["人体存在传感器", "主卧", "感应控制", 1, "个", 299, "/placeholder.svg"],
    ["智能开关", "次卧", "灯光控制", 2, "个", 219, "/placeholder.svg"],
    ["窗帘电机", "次卧", "窗帘控制", 1, "台", 699, "/placeholder.svg"],
    ["人体存在传感器", "卫生间", "感应控制", 1, "个", 299, "/placeholder.svg"],
    ["网络路由器", "全屋网络", "网络覆盖", 1, "台", 899, "/placeholder.svg"],
  ]
  const items = definitions.map(([name, room, category, quantity, unit, price, image], i) => ({
    id: `demo-product-${i}`, lineId: `demo-line-${i}`, name, room, category, quantity, unit, price, image,
    sku: `DEMO-${String(i + 1).padStart(3, "0")}`, spec: "演示选配，实际规格以项目记录为准", cost: 0,
    discount: 100, finalUnitPrice: price, subtotalAmount: price * quantity, finalAmount: price * quantity,
    productSnapshot: { quotationVerification: { status: "unverified", source: "default", reasons: ["演示型号与价格，不作为实际供货依据", ...(name === "窗帘电机" ? ["配套未计入本次报价：轨道长度、转角及配件待现场实测"] : [])] } },
  }))
  const rooms = [...new Set(items.map(i => i.room))]
  const points = items.flatMap((item, i) => Array.from({ length: item.quantity }, (_, n) => ({
    id: `demo-point-${i}-${n}`, name: item.name, room: item.room, iconId: "switch-1", status: "pending", usage: "selected", x: 15 + (i % 4) * 22, y: 20 + Math.floor(i / 4) * 27,
    productId: item.id, note: "演示点位，非客户现场定位", placed: true, floorId: "demo-floor", code: `P${i + 1}.${n + 1}`,
  })))
  const scene = (id, name, trigger, description, room) => ({ id, name, trigger, description, pointIds: points.filter(p => p.room === room).map(p => p.id), status: "proposed" })
  const scenes = [
    scene("arrive", "回家，先放松下来", "入户面板触发回家模式（演示）", "玄关与客厅预设灯组开启，窗帘切换到约定位置。先用一键操作，再按使用习惯细调。", "玄关"),
    scene("movie", "留一束光，给电影之夜", "客厅面板触发观影模式（演示）", "关闭客厅主要灯组，保留辅助照明，窗帘合拢。调光和影音联动是否加入，需要另核对具体设备能力。", "客餐厅"),
    scene("sleep", "晚安，让房间慢下来", "床边开关触发晚安模式（演示）", "关闭卧室主照明并关闭窗帘；是否保留夜灯，由家人共同确定。", "主卧"),
    scene("night", "起夜，有光也不打扰", "夜间检测到活动（演示）", "在约定时段开启指定夜灯。感应范围、延时与灯具条件，现场调试后确认。", "卫生间"),
    scene("leave", "出门前，少一遍来回检查", "入户面板触发离家模式（演示）", "关闭约定灯组，保留需持续供电的设备。每一个动作都先与家人确认。", "玄关"),
  ]
  const subtotal = items.reduce((sum, i) => sum + i.finalAmount, 0)
  const snapshot = {
    id: "demo-delivery", version: 1, createdAt: "2026-10-23T04:00:00.000Z", pointMapRevision: 1, fingerprint: "demo-only",
    project: { id: "demo-project", name: "栖云雅居 · 全屋智能提案", code: "DEMO-20261023", customer: "林先生与家人（虚构示例）", address: "示例住宅 · 地址为演示资料" },
    plan: { projectId: "demo-project", floorplanName: "示意户型", floorplanDataUrl: "", updatedAt: "2026-10-23", schemaVersion: 3, floors: [{ id: "demo-floor", name: "全屋", floorplanName: "演示户型", floorplanDataUrl: "", imageWidth: 1200, imageHeight: 800, rooms }], points, scenes },
    quote: { id: "demo-quote", quoteNo: "DEMO-QT-20261023", title: "演示报价", status: "draft", subtotal, discount: 0, installationFee: 1800, total: subtotal + 1800, rooms, items },
    products: items.map(i => ({ id: i.id, name: i.name, image: i.image, imageSource: i.image, visualAsset: null })),
    changes: { messages: [], floorIds: [], pointsAdded: 0, pointsRemoved: 0, pointsChanged: 0, productsChanged: [], photosChanged: [], scenesChanged: false, quoteChanged: false, productOverrides: 0, comparedToVersion: null },
  }
  const cells = [["玄关", 40, 40, 260, 180], ["客餐厅", 320, 40, 560, 420], ["主卧", 40, 240, 260, 330], ["次卧", 900, 40, 260, 330], ["卫生间", 900, 390, 260, 180], ["全屋网络", 320, 480, 560, 150]]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#faf8f4"/><text x="40" y="710" font-size="23" font-family="sans-serif" fill="#6c6258">演示户型 · 非客户实际点位图 · 真实导出使用项目已保存图纸</text>${cells.map(([name,x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#eee6da" stroke="#4f4841" stroke-width="4"/><text x="${x+24}" y="${y+40}" font-size="26" font-family="sans-serif" fill="#403a33">${name}</text>${points.filter(p=>p.room===name).slice(0,6).map((p,n)=>`<circle cx="${x+36+(n%3)*70}" cy="${y+90+Math.floor(n/3)*62}" r="17" fill="#825c3c"/><text x="${x+36+(n%3)*70}" y="${y+96+Math.floor(n/3)*62}" font-size="14" text-anchor="middle" fill="white" font-family="sans-serif">${n+1}</text>`).join("")}`).join("")}</svg>`
  const floors = [{ id: "demo-floor", name: "全屋", src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` }]
  const brand = { companyName: "繁梦空间智能设计", logoSrc: "/assets/brand/fmkj-copilot.png", contact: "", address: "", qrSrc: "" }
  const documents = new Map()
  for (const [theme, title] of sampleThemes) {
    const html = renderToStaticMarkup(React.createElement(FirstProposalDocument, { snapshot, floors, brand, theme, demo: true }))
    const inlineAssets = new Map()
    for (const match of html.matchAll(/src="(\/assets\/[^"?]+)"/g)) {
      const src = match[1]
      if (inlineAssets.has(src)) continue
      const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" })[path.extname(src)]
      inlineAssets.set(src, `data:${mime};base64,${(await readFile(path.join(root, "public", src))).toString("base64")}`)
    }
    const standalone = html.replace(/src="(\/assets\/[^"?]+)"/g, (_match, src) => `src="${inlineAssets.get(src)}"`)
    const doc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title} · 初次提案模板</title><style>${globals}\n${css}\nhtml,body{margin:0;padding:0;background:#e8e6e2}body>main{position:static!important;width:190mm!important;margin:auto}.first-proposal-document{display:block!important}@media screen{.fp-sample-original{display:none}}@page{size:A4;margin:10mm}@media print{html,body{background:white}body *{visibility:visible!important}.first-proposal-document{display:block!important}}</style><body data-proposal-preview><main class="project-presentation" data-proposal-print="true"><section class="fp-sample-original">原方案正文隔离检查</section>${standalone}</main></body></html>`
    documents.set(`/${theme}.html`, doc)
    await writeFile(path.join(output, `${title}.html`), doc)
  }
  server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (documents.has(url.pathname)) { res.setHeader("content-type", "text/html;charset=utf-8"); res.end(documents.get(url.pathname)); return }
      const pathname = path.resolve(root, "public", `.${decodeURIComponent(url.pathname)}`)
      if (!pathname.startsWith(path.join(root, "public") + path.sep)) { res.writeHead(403).end(); return }
      const bytes = await readFile(pathname)
      const ext = path.extname(pathname)
      res.setHeader("content-type", ({ ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" })[ext] || "application/octet-stream")
      res.end(bytes)
    } catch { res.writeHead(404).end() }
  })
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve) })
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
  const report = []
  for (const [theme, title] of sampleThemes) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
    await page.goto(`http://127.0.0.1:${port}/${theme}.html`, { waitUntil: "networkidle" })
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))) })
    const checks = await page.evaluate(() => ({
      images: [...document.images].map(i => ({ src: i.getAttribute("src")?.slice(0,100), ready: i.complete && i.naturalWidth > 0 })),
      pages: [...document.querySelectorAll(".fp-page")].map(p=>({height:p.getBoundingClientRect().height,width:p.getBoundingClientRect().width})),
      overflow: [...document.querySelectorAll(".first-proposal-document *")].filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 3 && getComputedStyle(e).overflowX !== "visible").map(e=>({tag:e.tagName,class:e.className})),
      text: document.body.innerText,
    }))
    if (checks.images.some(i => !i.ready)) throw new Error(`${theme} has missing images: ${JSON.stringify(checks.images.filter(i=>!i.ready))}`)
    await page.pdf({ path: path.join(output, `${title}-首次提案模板.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true })
    await page.screenshot({ path: path.join(output, `${theme}-desktop.png`), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(output, `${theme}-mobile.png`), fullPage: true })
    report.push({theme, ...checks})
    await page.close()
  }
  await writeFile(path.join(output, "render-report.json"), JSON.stringify(report, null, 2))
  console.log(`Rendered four production templates with fictional data to ${output}`)
} finally {
  await browser?.close()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  await vite.close()
}
