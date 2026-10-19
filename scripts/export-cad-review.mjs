#!/usr/bin/env node
import { POINT_MAP_IMAGE_LONG_EDGE } from "../lib/point-map-image-size.mjs";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CadcraftClient } from "./cadcraft/mcp-client.mjs";
import { queryAll, sha256 } from "./cadcraft/bridge.mjs";
import { renderClippedCadReview } from "./cadcraft/clipped-review.mjs";
import { readCadViewportSource, restoreLayoutViewports } from "./cadcraft/viewport-source.mjs";

const runFile = promisify(execFile);
export const usage = `DWG/DXF 原图对照包（本机 CADCraft CLI + Poppler pdftoppm）
node scripts/export-cad-review.mjs --source original.dwg --out-dir new-output [--cli /path/cadcraft-cli] [--pdftoppm /path/pdftoppm] [--python /path/python-with-pypdf] [--color-mode readable|original]
先导出 Model / 全部布局总览，再导出可识别图框的逐页 PDF、PNG 和可并排查看的 index.html。
重复图名和编号不去重；未成图框的内容保留在总览，视口无模型内容会标记，须人工确认完整性。
默认白底深色阅读配色，同时保留 CAD 原色；可用 --color-mode original 只导出原色。
输出目录必须尚不存在。原图仅读，按原视口冻结图层显示，不清理文字、不写数据库。`;

export function parseCadReviewArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--source", "--out-dir", "--cli", "--pdftoppm", "--python", "--color-mode"].includes(args[i]) || Object.hasOwn(flags, args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`参数无效：${args[i]}\n${usage}`);
    flags[args[i]] = args[i + 1];
  }
  if (!flags["--source"] || !flags["--out-dir"]) throw new Error(usage);
  if (flags["--color-mode"] && !["readable", "original"].includes(flags["--color-mode"])) throw new Error("配色仅支持 readable / original。");
  return { source: flags["--source"], outDir: flags["--out-dir"], cli: flags["--cli"], pdftoppm: flags["--pdftoppm"], python: flags["--python"], colorMode: flags["--color-mode"] ?? "readable" };
}

async function readingPython(explicit) {
  const candidates = explicit ? [explicit] : [join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"), "python3"];
  for (const candidate of candidates) {
    try { await runFile(candidate, ["-c", "import pypdf"], { timeout: 10_000 }); return candidate; } catch { /* Try the next installed local runtime. */ }
  }
  throw new Error("清晰阅读配色需要本机 Python / pypdf；可指定 --python，或用 --color-mode original 保留原色导出。");
}

export async function makeCadReviewReadable(source, output, python) {
  await runFile(python, [fileURLToPath(new URL("./cadcraft/readable-pdf.py", import.meta.url)), source, output], { timeout: 300_000, maxBuffer: 1024 * 1024 });
}

function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 2 && bounds.every(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) && bounds[1][0] > bounds[0][0] && bounds[1][1] > bounds[0][1];
}
function area(b) { return (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]); }
function contains(b, p) { return p.x >= b[0][0] && p.x <= b[1][0] && p.y >= b[0][1] && p.y <= b[1][1]; }
function encloses(a, b) {
  const tolerance = Math.sqrt(area(a)) * 0.025;
  return a[0][0] - tolerance <= b[0][0] && a[0][1] - tolerance <= b[0][1] && a[1][0] + tolerance >= b[1][0] && a[1][1] + tolerance >= b[1][1];
}
export function viewportModelWindow(entity) {
  const g = entity.geometry;
  if (g?.type !== "viewport" || ![g.height, g.width, g.viewHeight, g.viewCenter?.x, g.viewCenter?.y].every(Number.isFinite) || Math.min(g.height, g.width, g.viewHeight) <= 0) return null;
  // The paper-space camera itself is not a sheet viewport.
  if (g.center && Math.abs(g.viewCenter.x - g.center.x) < 1e-6 && Math.abs(g.viewCenter.y - g.center.y) < 1e-6 && Math.abs(g.viewHeight - g.height) < 1e-6) return null;
  const h = g.viewHeight, w = h * g.width / g.height;
  return [[g.viewCenter.x - w / 2, g.viewCenter.y - h / 2], [g.viewCenter.x + w / 2, g.viewCenter.y + h / 2]];
}

/** Bounds come from CADCraft, including native block transforms, not guessed insertion points. */
export function detectCadReviewSheets(space, entities, objects) {
  const viewports = objects.filter(e => viewportModelWindow(e) && validBounds(e.bounds));
  const candidates = objects.filter(e => {
    if (e.geometry?.type !== "insert" || e.visible === false || !validBounds(e.bounds)) return false;
    const ratio = Math.max(e.bounds[1][0] - e.bounds[0][0], e.bounds[1][1] - e.bounds[0][1]) / Math.min(e.bounds[1][0] - e.bounds[0][0], e.bounds[1][1] - e.bounds[0][1]);
    if (ratio < 1.2 || ratio > 1.8) return false;
    return space === "Model" ? /图框|frame|border/i.test(e.layer) : viewports.some(v => encloses(e.bounds, v.bounds));
  });
  // Several viewports inside one frame are one sheet. Never deduplicate by title/number.
  const frames = candidates.filter(e => !candidates.some(other => other !== e && area(other.bounds) < area(e.bounds) * 0.98 && encloses(e.bounds, other.bounds)));
  return frames.sort((a, b) => b.bounds[1][1] - a.bounds[1][1] || a.bounds[0][0] - b.bounds[0][0]).map(frame => {
    const texts = entities.filter(e => ["text", "mText"].includes(e.geometry?.type) && e.geometry.insert && contains(frame.bounds, e.geometry.insert));
    const labels = texts.filter(e => /图框|frame|border/i.test(e.layer)).map(e => String(e.geometry.value ?? e.geometry.contents ?? "").slice(0, 300));
    return { space, handle: frame.handle, bounds: frame.bounds, labels, viewports: viewports.filter(v => encloses(frame.bounds, v.bounds)).map(v => ({ handle: v.handle, window: viewportModelWindow(v), frozenLayers: v.geometry.frozenLayers ?? [], sourceDisplayCenter: v.geometry.sourceDisplayCenter, sourceTargetPoint: v.geometry.sourceTargetPoint })) };
  });
}

export async function mergeCadReviewPdf(manifest, outDir, python) {
  const pages = [...manifest.overviews, ...manifest.sheets];
  const mergeInput = join(outDir, ".merge-input.json");
  await writeFile(mergeInput, JSON.stringify(pages.map(p => ({ pdf: p.pdf, label: `${p.space} · ${p.labels?.join(" / ") || "总览"} · ${p.id}${p.warning ? "（需复核）" : ""}` }))), { flag: "wx" });
  try {
    await runFile(python, ["-c", `import json,sys
from pathlib import Path
from pypdf import PdfReader,PdfWriter
from pypdf import filters
filters.MAX_DECLARED_STREAM_LENGTH=1_000_000_000
root=Path(sys.argv[1]); pages=json.loads((root/'.merge-input.json').read_text())
writer=PdfWriter()
for item in pages:
    reader=PdfReader(root/item['pdf'])
    if len(reader.pages)!=1: raise ValueError('Expected one page per CAD export')
    writer.append(reader,outline_item=item['label'])
with (root/'all-pages.pdf').open('xb') as output: writer.write(output)
if len(PdfReader(root/'all-pages.pdf').pages)!=len(pages): raise ValueError('Combined PDF page count mismatch')
`, outDir], { timeout: 300_000, maxBuffer: 1024 * 1024 });
    manifest.combinedPdf = "all-pages.pdf";
  } finally { await rm(mergeInput, { force: true }); }
}

export function cadReviewPageCategory(page) {
  const name = (page.labels ?? []).join(" / ");
  if (page.kind === "overview" || /立面|剖面|索引/.test(name)) return "other";
  if (/开关/.test(name)) return "switch";
  if (/灯具定位|灯光|灯位|灯具布置|照明.*(?:点位|布置|定位)/.test(name)) return "lighting";
  if (/平面布置|家具布置|布局图/.test(name)) return "layout";
  return "other";
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function cadReviewHtml(manifest) {
  const pages = [...manifest.overviews, ...manifest.sheets];
  const categories = pages.map(cadReviewPageCategory);
  const title = p => `${p.space} · ${p.kind === "overview" ? "总览" : p.labels.join(" / ") || "未命名图框"} · ${p.id}`;
  const firstPage = manifest.sheets.length ? manifest.overviews.length : 0;
  const leftPage = Math.max(0, manifest.preferredPageIds?.[0] ? pages.findIndex(p => p.id === manifest.preferredPageIds[0]) : firstPage);
  const rightPage = Math.max(0, manifest.preferredPageIds?.[1] ? pages.findIndex(p => p.id === manifest.preferredPageIds[1]) : firstPage + 1);
  const assetVersion = encodeURIComponent(manifest.renderedAt ?? `${manifest.version ?? 1}-${manifest.createdAt ?? ""}`);
  const options = pages.map((p, i) => `<option value="${i}">${escapeHtml(title(p))}</option>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DWG 原图逐页对照</title><style>body{margin:0;padding:24px;background:#f3f4ef;color:#203b2e;font:15px/1.7 system-ui}header{max-width:1200px;margin:auto}h1{font-size:28px}button,select,input{padding:10px;border:1px solid #bbc9bd;border-radius:6px;background:white}select{max-width:100%}.note{background:#fff2cd;padding:14px;border-radius:8px}.compare,.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.compare{margin:24px 0}.panel,article{background:white;padding:14px;border:1px solid #dae1d6;border-radius:8px}.canvas{overflow:auto;max-height:75vh;background:white}.compare img{display:block;width:100%;height:auto;max-width:none}.zoom{display:flex;gap:8px;margin:10px 0}.grid img{width:100%;aspect-ratio:1.414;object-fit:contain}a{color:#216848}small{display:block;color:#6b786b}.warn{color:#9a4800}.grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}[hidden]{display:none!important}@media(max-width:750px){body{padding:14px}.compare{grid-template-columns:1fr}}</style><header><h1>${escapeHtml(manifest.sourceName)} · 原图对照</h1><p>${manifest.sheets.length} 张识别图框，${manifest.overviews.length} 张空间总览。默认只看布局、灯光点位、开关点位三类；重名方案分别保留。</p><p class="note">图框识别不是完整性确认。无图框或特殊图框内容请查总览；视口按原文件目标坐标与冻结图层恢复；仍为空白的页面需人工核对。文字、尺寸和图例保留；默认使用白底深色阅读配色，可切换 CAD 原色。不作为已确认净底或点位方案。</p><p><a href="manifest.json">来源与页码清单</a>${manifest.combinedPdf === "all-pages.pdf" ? ` · <a href="all-pages.pdf">${manifest.colorMode === "readable" ? "全部原图阅读版 PDF（含其他图纸）" : "全部原图 PDF（含其他图纸）"}</a>` : ""}</p>${pages.some(p => p.originalPng) ? '<label>显示配色 <select id="palette"><option value="readable">清晰黑白（推荐）</option><option value="original">CAD 原色</option></select></label>' : ""}<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center"><label>图纸筛选 <select id="category"><option value="needed">所需三类图纸</option><option value="layout">布局图</option><option value="lighting">灯光点位图</option><option value="switch">开关点位图</option><option value="all">全部原图</option></select></label><input id="search" placeholder="搜索图名、编号或来源" aria-label="搜索图纸"><span id="filter-count" role="status"></span></div><p id="empty-filter" hidden>没有符合条件的图纸，请调整筛选或搜索。</p><div class="compare">${["left", "right"].map(id => `<div class="panel"><select id="${id}">${options}</select><p><a id="${id}-pdf" target="_blank">打开原图 PDF</a> · <a id="${id}-image" target="_blank">放大 PNG</a></p><div class="zoom"><button data-zoom="1.5" data-view="${id}">放大 +</button><button data-zoom="0.666667" data-view="${id}">缩小 −</button><button data-zoom="0" data-view="${id}">适应窗口</button></div><div class="canvas"><img id="${id}-preview" alt="原图对照"></div><small id="${id}-note"></small></div>`).join("")}</div></header><main class="grid">${pages.map((p, i) => `<article data-search="${escapeHtml(title(p))}"${categories[i] === "other" ? " hidden" : ""}><a href="${p.pdf}" target="_blank"><img loading="lazy" src="${p.png}?v=${assetVersion}" alt="${escapeHtml(title(p))}"></a><b>${escapeHtml(title(p))}</b><small class="warn">${escapeHtml(p.warning ?? "")}</small><button data-pick="${i}" data-side="left">左侧对照</button> <button data-pick="${i}" data-side="right">右侧对照</button></article>`).join("")}</main><script>const pages=${JSON.stringify(pages.map(p => ({ pdf: p.pdf, png: p.png, originalPdf: p.originalPdf, originalPng: p.originalPng, warning: p.warning ?? "", title: title(p), category: cadReviewPageCategory(p) }))).replace(/</g, "\\u003c")};function show(side){const selected=document.getElementById(side);if(selected.selectedIndex<0)return;const p=pages[Number(selected.value)];const original=document.getElementById('palette')?.value==='original';const png=original&&p.originalPng?p.originalPng:p.png;document.getElementById(side+'-preview').src=png+'?v=${assetVersion}';document.getElementById(side+'-pdf').href=original&&p.originalPdf?p.originalPdf:p.pdf;document.getElementById(side+'-image').href=png;document.getElementById(side+'-note').textContent=p.warning}for(const side of ['left','right']){document.getElementById(side).onchange=()=>{show(side);resizeView(side,0)}}document.getElementById('left').selectedIndex=Math.min(${leftPage},pages.length-1);document.getElementById('right').selectedIndex=Math.min(${rightPage},pages.length-1);function resizeView(side,factor){const img=document.getElementById(side+'-preview');const scale=factor===0?1:Math.min(6,Math.max(1,Number(img.dataset.zoom||1)*factor));img.dataset.zoom=scale;img.style.width=(scale*100)+'%'}document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>resizeView(b.dataset.view,Number(b.dataset.zoom)));show('left');show('right');const palette=document.getElementById('palette');if(palette)palette.onchange=()=>{show('left');show('right');document.querySelectorAll('article').forEach((a,i)=>{const p=pages[i],original=palette.value==='original';a.querySelector('img').src=(original&&p.originalPng?p.originalPng:p.png)+'?v=${assetVersion}';a.querySelector('a').href=original&&p.originalPdf?p.originalPdf:p.pdf})};document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{document.getElementById(b.dataset.side).value=b.dataset.pick;show(b.dataset.side);window.scrollTo({top:0,behavior:'smooth'})});function applyFilter(){const category=document.getElementById('category').value,query=document.getElementById('search').value.trim().toLowerCase();const matching=pages.map((p,i)=>({p,i})).filter(({p})=>(category==='all'||(category==='needed'?p.category!=='other':p.category===category))&&p.title.toLowerCase().includes(query));const visible=new Set(matching.map(({i})=>i));document.querySelectorAll('article').forEach((a,i)=>a.hidden=!visible.has(i));document.getElementById('filter-count').textContent='显示 '+matching.length+' 张';document.getElementById('empty-filter').hidden=matching.length>0;document.querySelector('.compare').hidden=matching.length===0;for(const [side,n] of [['left',0],['right',1]]){const select=document.getElementById(side),previous=Number(select.value);select.replaceChildren(...matching.map(({p,i})=>{const option=document.createElement('option');option.value=String(i);option.textContent=p.title;return option}));if(matching.length){select.value=String(visible.has(previous)?previous:matching[Math.min(n,matching.length-1)].i);show(side);resizeView(side,0)}}}document.getElementById('category').onchange=applyFilter;document.getElementById('search').oninput=applyFilter;applyFilter();</script></html>`;
}

export async function exportCadReview(options, dependencies = {}) {
  const source = await realpath(resolve(options.source));
  if (!/\.(dwg|dxf)$/i.test(source) || !(await lstat(source)).isFile()) throw new Error("源文件必须是本机 DWG / DXF。");
  const sourceBytes = await readFile(source), sourceSha256 = sha256(sourceBytes);
  const outDir = resolve(options.outDir);
  await mkdir(outDir); // Reject existing directories, even an incomplete prior run.
  const staging = await mkdtemp(join(outDir, ".cad-review-"));
  const copiedSource = join(staging, `source${extname(source).toLowerCase()}`);
  const client = (dependencies.createClient ?? ((cli, config) => new CadcraftClient(cli, config)))(options.cli ?? process.env.CADCRAFT_CLI ?? "cadcraft-cli", { timeoutMs: 180_000 });
  const rasterize = dependencies.rasterize ?? (async (pdf, png) => {
    await runFile(options.pdftoppm ?? "pdftoppm", ["-scale-to", String(POINT_MAP_IMAGE_LONG_EDGE), "-png", "-singlefile", pdf, png.slice(0, -4)], { timeout: 300_000, maxBuffer: 1024 * 1024 });
  });
  const progress = dependencies.progress ?? (() => {});
  const colorMode = options.colorMode ?? "readable";
  const manifest = { format: "fmkj-cad-review", version: 3, colorMode, renderer: "cadcraft", sourceName: basename(source), sourceSha256, createdAt: new Date().toISOString(), completeness: "requires-human-review", overviews: [], sheets: [], warnings: [] };
  let timer;
  try {
    timer = setTimeout(() => { void client.close(); }, 45 * 60_000);
    await writeFile(copiedSource, sourceBytes, { flag: "wx", mode: 0o400 });
    await chmod(copiedSource, 0o400);
    const python = colorMode === "readable" && !dependencies.readablePdf ? await readingPython(options.python) : options.python;
    const readablePdf = dependencies.readablePdf ?? ((source, output) => makeCadReviewReadable(source, output, python));
    const viewportSource = await (dependencies.readViewports ?? readCadViewportSource)(sourceBytes, extname(source));
    manifest.warnings.push(...viewportSource.warnings);
    const clippedSource = viewportSource.renderDxf ? join(staging, "source-preserved.dxf") : null;
    if (clippedSource) await writeFile(clippedSource, viewportSource.renderDxf);
    manifest.renderer = clippedSource ? "ezdxf-xclip" : "cadcraft";
    const prepareSpace = async (space) => {
      await client.execute("layout.set", { name: space });
      const entities = await queryAll(client);
      const restored = await restoreLayoutViewports(client, viewportSource.viewports, entities);
      return entities.map(e => restored.get(e.handle) ?? e);
    };
    await client.initialize();
    await client.tool("open", { path: copiedSource });
    const layouts = await client.execute("layout.list");
    if (!Array.isArray(layouts) || layouts.length > 100 || layouts.some(l => typeof l.name !== "string")) throw new Error("布局清单异常。");
    const spaces = ["Model", ...layouts.map(l => l.name).filter(n => n !== "Model")];
    const plans = [];
    for (const space of spaces) {
      const entities = await prepareSpace(space), objects = [];
      const relevant = entities.filter(e => ["insert", "viewport"].includes(e.geometry?.type));
      for (let i = 0; i < relevant.length; i += 100) {
        const result = await client.execute("properties", { handles: relevant.slice(i, i + 100).map(e => e.handle) });
        if (!Array.isArray(result.objects) || result.objects.length !== Math.min(100, relevant.length - i)) throw new Error("图框原生范围查询不完整。");
        objects.push(...result.objects.map(object => {
          const entity = entities.find(e => e.handle === object.handle);
          return entity?.geometry?.sourceTargetPoint ? { ...object, geometry: { ...object.geometry, ...entity.geometry } } : object;
        }));
      }
      plans.push({ space, sheets: detectCadReviewSheets(space, entities, objects) });
    }
    if (plans.reduce((sum, p) => sum + p.sheets.length, 0) > 500) throw new Error("识别图框超过 500 张，请分批导出。");
    const exportPdf = async (page) => {
      progress(`正在导出 ${page.id} · ${page.space}…`);
      if (clippedSource) {
        if (colorMode === "readable") { page.originalPdf = page.pdf.replace(/\.pdf$/, ".original.pdf"); page.originalPng = page.png.replace(/\.png$/, ".original.png"); }
        return;
      }
      if (page.space !== "Model") await client.execute("pagesetup", { layout: page.space, plotArea: "extents", center: true, scaleToFit: true });
      await client.execute("exportpdf", { path: join(outDir, page.pdf), paper: "A3", landscape: true, fit: true });
      if ((await stat(join(outDir, page.pdf))).size > 1_000_000_000) throw new Error("单页 PDF 超过 1 GB，请先核对异常图元。");
      if (colorMode === "readable") {
        page.originalPdf = page.pdf.replace(/\.pdf$/, ".original.pdf");
        page.originalPng = page.png.replace(/\.png$/, ".original.png");
        await rename(join(outDir, page.pdf), join(outDir, page.originalPdf));
        await rasterize(join(outDir, page.originalPdf), join(outDir, page.originalPng));
        await readablePdf(join(outDir, page.originalPdf), join(outDir, page.pdf));
      }
      await rasterize(join(outDir, page.pdf), join(outDir, page.png));
      progress(`${page.id} ${page.space} ${page.labels?.join(" / ") ?? "总览"}`);
    };
    for (const [index, plan] of plans.entries()) {
      await client.tool("open", { path: copiedSource });
      await prepareSpace(plan.space);
      const id = `overview-${String(index + 1).padStart(2, "0")}`;
      const page = { id, kind: "overview", space: plan.space, pdf: `${id}.pdf`, png: `${id}.png` };
      await exportPdf(page); manifest.overviews.push(page);
      if (!plan.sheets.length) manifest.warnings.push(`${plan.space} 未识别逐页图框，请检查总览。`);
      for (const sheet of plan.sheets) {
        const n = manifest.sheets.length + 1, id = `page-${String(n).padStart(3, "0")}`;
        const page = { ...sheet, id, kind: "sheet", pdf: `${id}.pdf`, png: `${id}.png` };
        await client.tool("open", { path: copiedSource });
        await client.execute("layout.set", { name: "Model" });
        for (const vp of page.viewports) {
          const contents = await client.tool("query_entities", { window: vp.window, limit: 0 });
          vp.modelEntityCount = contents.count;
        }
        if (page.viewports.some(v => v.modelEntityCount === 0)) page.warning = "按完整视口参数读取后未找到模型实体，需人工核对。";
        await prepareSpace(plan.space);
        const bounds = page.bounds.map(p => [...p]);
        const pad = Math.sqrt(area(bounds)) * 0.001;
        bounds[0][0] -= pad; bounds[0][1] -= pad; bounds[1][0] += pad; bounds[1][1] += pad;
        if (clippedSource) {
          // The original DXF renderer crops the requested frame without lossy wblock conversion.
        } else if (plan.space === "Model") {
          const entities = await queryAll(client, { window: bounds, crossing: false });
          if (!entities.length) throw new Error(`图框 ${page.handle} 无可导出实体。`);
          const extracted = join(staging, "page.dxf");
          await client.execute("wblock", { path: extracted, handles: entities.map(e => e.handle), base: [0, 0] });
          await client.tool("open", { path: extracted });
        } else {
          const all = await queryAll(client), keep = new Set((await queryAll(client, { window: bounds, crossing: true })).map(e => e.handle));
          const remove = all.filter(e => !keep.has(e.handle)).map(e => e.handle);
          for (let i = 0; i < remove.length; i += 500) await client.execute("erase", { handles: remove.slice(i, i + 500) });
        }
        await exportPdf(page); manifest.sheets.push(page);
      }
    }
    await client.close();
    if (clippedSource) {
      const renderPython = python ?? (dependencies.renderClipped ? undefined : await readingPython(options.python));
      const rendered = await (dependencies.renderClipped ?? renderClippedCadReview)(manifest, clippedSource, viewportSource, staging, outDir, renderPython, progress);
      manifest.clippingRender = { pages: rendered.length, spatialFilters: viewportSource.spatialFilterCount, fontFallback: "Arial Unicode (local macOS font)" };
    }
    if (sha256(await readFile(source)) !== sourceSha256) throw new Error("导出期间源文件发生变化，请重新导出。");
    if (options.python) { progress("正在合并带目录的全部页面 PDF…"); await mergeCadReviewPdf(manifest, outDir, options.python); }
    await writeFile(join(outDir, "index.html"), cadReviewHtml(manifest), { flag: "wx" });
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    return manifest;
  } finally {
    clearTimeout(timer);
    await client.close();
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseCadReviewArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else { const result = await exportCadReview(options, { progress: console.log }); console.log(`完成：${result.sheets.length} 张图框、${result.overviews.length} 张总览。打开 ${resolve(options.outDir, "index.html")} 人工核对。`); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
