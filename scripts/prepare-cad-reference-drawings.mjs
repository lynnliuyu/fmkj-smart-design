#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { resolve, join, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CadcraftClient } from "./cadcraft/mcp-client.mjs";
import { queryAll, sha256 } from "./cadcraft/bridge.mjs";
import { normalizeCadFloorplanSvg, rasterizeCadFloorplan, parseCadWindow } from "./prepare-cad-floorplan.mjs";
import { makeCadReviewReadable } from "./export-cad-review.mjs";
import { pointMapImageSize } from "../lib/point-map-image-size.mjs";
import { fileURLToPath } from "node:url";

const runFile = promisify(execFile);
const usage = "node scripts/prepare-cad-reference-drawings.mjs --source original.dwg --plan saved-plan.json --review-manifest review/manifest.json --floor-id floor-id --lighting-page page-029 --switch-page page-030 --out-dir new-output [--project-id uuid] [--cli /path/cadcraft-cli]";
export function parseReferencePreparationArgs(args) {
  const names = ["--source", "--plan", "--review-manifest", "--floor-id", "--lighting-page", "--switch-page", "--out-dir", "--project-id", "--cli"];
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || Object.hasOwn(flags, args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(usage);
    flags[args[i]] = args[i + 1];
  }
  for (const key of names.slice(0, 7)) if (!flags[key]) throw new Error(usage);
  return flags;
}

/** Only reviewed common-coordinate views; image dimensions are not evidence of alignment. */
export function referencePreparationViews(manifest, sourceHash, window, lightingPage, switchPage) {
  if (manifest.format !== "fmkj-cad-review" || manifest.sourceSha256 !== sourceHash) throw new Error("对照清单与原图指纹不符。");
  return [["lighting", lightingPage], ["switch", switchPage]].map(([kind, id]) => {
    const sheet = manifest.sheets?.find((page) => page.id === id);
    if (!sheet || sheet.warning || sheet.viewports?.length !== 1 || !sheet.viewports[0].modelEntityCount) throw new Error(`${id} 不是可用的单视口原图页，请先人工核对。`);
    const viewport = sheet.viewports[0], bounds = viewport.window;
    if (!bounds || window[0] < bounds[0][0] || window[1] < bounds[0][1] || window[2] > bounds[1][0] || window[3] > bounds[1][1])
      throw new Error(`${id} 与当前布局不在共同坐标范围，请先配准，不能按图片比例叠放。`);
    if (!Array.isArray(viewport.frozenLayers) || viewport.frozenLayers.some((name) => typeof name !== "string")) throw new Error(`${id} 缺少原图冻结图层记录。`);
    return { kind, sheet, viewport };
  });
}

export async function prepareCadReferenceDrawings(flags, dependencies = {}) {
  const source = resolve(flags["--source"]), output = resolve(flags["--out-dir"]);
  if (!/\.(dwg|dxf)$/i.test(source)) throw new Error("原文件必须为 DWG 或 DXF。");
  const bytes = await readFile(source), sourceHash = sha256(bytes);
  const payload = JSON.parse(await readFile(resolve(flags["--plan"]), "utf8"));
  const plan = payload.data ?? payload.plan ?? payload;
  const projectId = plan.projectId ?? flags["--project-id"];
  if (typeof projectId !== "string" || !/^[\da-f-]{36}$/i.test(projectId)) throw new Error("请提供所属项目 ID。");
  const floor = plan.floors?.find((item) => item.id === flags["--floor-id"]);
  if (!floor?.cad || !floor.floorplanDataUrl) throw new Error("当前楼层需要完整布局净底与 CAD 坐标绑定。");
  const window = parseCadWindow(floor.cad.window);
  const manifest = JSON.parse(await readFile(resolve(flags["--review-manifest"]), "utf8"));
  const views = referencePreparationViews(manifest, sourceHash, window, flags["--lighting-page"], flags["--switch-page"]);
  await mkdir(output);
  const staging = await mkdtemp(join(output, ".cad-references-"));
  const copied = join(staging, `source${extname(source)}`);
  const cli = flags["--cli"] ?? process.env.CADCRAFT_CLI ?? "cadcraft-cli";
  const client = (dependencies.createClient ?? ((path) => new CadcraftClient(path)))(cli);
  const references = {}, evidence = [];
  try {
    await writeFile(copied, bytes, { mode: 0o400, flag: "wx" });
    await client.initialize();
    for (const { kind, sheet, viewport } of views) {
      dependencies.progress?.(`正在导出 ${sheet.id} ${sheet.labels?.join(" / ")}…`);
      await client.tool("open", { path: copied });
      await client.execute("layout.set", { name: "Model" });
      const drawing = await client.tool("inspect_drawing");
      const hidden = new Set(viewport.frozenLayers);
      for (const layer of drawing.layers) if (hidden.has(layer.name) && layer.on) await client.execute("layer.set", { name: layer.name, on: false });
      const selected = await queryAll(client, { window: [window.slice(0, 2), window.slice(2)], crossing: true });
      if (!selected.length) throw new Error(`${sheet.id} 在布局范围内没有图形。`);
      const dxf = join(staging, `${kind}.dxf`), raw = join(staging, `${kind}.svg`);
      await client.execute("wblock", { path: dxf, handles: selected.map((item) => item.handle), base: [0, 0] });
      await client.tool("open", { path: dxf });
      const extracted = await client.tool("inspect_drawing");
      for (const layer of extracted.layers) if (hidden.has(layer.name) && layer.on) await client.execute("layer.set", { name: layer.name, on: false });
      await client.tool("save", { path: dxf });
      await (dependencies.convert ?? (async () => runFile(cli, ["convert", dxf, raw, "--window", window.join(",")], { timeout: 55_000, maxBuffer: 1024 * 1024, shell: false })))({ dxf, svg: raw, window });
      const svg = join(output, `${kind}.svg`), png = join(output, `${kind}.png`);
      let visual, method = "svg-common-window";
      if ((await stat(raw)).size <= 40_000_000) {
        visual = normalizeCadFloorplanSvg(await readFile(raw, "utf8"), window);
        await writeFile(svg, visual.svg, { flag: "wx" });
        await (dependencies.rasterize ?? rasterizeCadFloorplan)(visual.svg, png);
      } else {
        // Dense switch wiring explodes into millions of SVG segments. Native PDF retains it compactly.
        dependencies.progress?.(`${sheet.id} 图元较密，改用原生 PDF 保留坐标与控制线…`);
        method = "pdf-common-window";
        const pdf = join(staging, `${kind}.pdf`), readable = join(staging, `${kind}-readable.pdf`), framed = join(output, `${kind}.pdf`);
        const python = process.env.CAD_REVIEW_PYTHON ?? join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3");
        await runFile(cli, ["convert", dxf, pdf, "--window", window.join(",")], { timeout: 55_000, maxBuffer: 1024 * 1024, shell: false });
        await makeCadReviewReadable(pdf, readable, python);
        await runFile(python, [fileURLToPath(new URL("./cadcraft/crop-reference-pdf.py", import.meta.url)), readable, framed, String(window[2] - window[0]), String(window[3] - window[1])], { timeout: 55_000, maxBuffer: 1024 * 1024 });
        const prefix = join(staging, `${kind}-raster`);
        await runFile(process.env.PDFTOPPM ?? "pdftoppm", ["-png", "-singlefile", "-scale-to", "3000", framed, prefix], { timeout: 55_000, maxBuffer: 1024 * 1024 });
        visual = pointMapImageSize(window[2] - window[0], window[3] - window[1]);
        const { default: sharp } = await import("sharp");
        const rendered = sharp(`${prefix}.png`);
        const size = await rendered.metadata();
        if (Math.abs(size.width / size.height / (visual.width / visual.height) - 1) > .005) throw new Error("原生 PDF 的图纸比例不符，停止发布以免错位。");
        await rendered.resize(visual.width, visual.height).png().toFile(png);
      }
      const image = await readFile(png);
      references[kind] = { name: `${sheet.labels?.join(" · ") || kind} · CAD 原图对照`, imageDataUrl: `data:image/png;base64,${image.toString("base64")}`, imageWidth: visual.width, imageHeight: visual.height,
        sourceFingerprint: sha256(Buffer.from(floor.floorplanDataUrl)), matrix: [1, 0, 0, 1, 0, 0],
        anchors: [[0, 0], [100, 0], [0, 100], [100, 100]].map(([x, y]) => ({ source: { x, y }, target: { x, y } })),
      };
      evidence.push({ kind, method, page: sheet.id, labels: sheet.labels, viewportHandle: viewport.handle, frozenLayers: viewport.frozenLayers, cadWindow: window, selected: selected.length, pngSha256: sha256(image) });
    }
  } finally { await client.close(); await rm(staging, { recursive: true, force: true }); }
  if (sha256(await readFile(source)) !== sourceHash) throw new Error("原图指纹变化，未发布图纸包。");
  const bundle = { format: "fmkj-point-map-references", version: 1, projectId, floors: [{ floorId: floor.id, references }] };
  await writeFile(join(output, "references.json"), JSON.stringify(bundle), { flag: "wx" });
  const report = { sourceName: basename(source), sourceSha256: sourceHash, projectId, floorId: floor.id, layoutFingerprint: references.lighting.sourceFingerprint, window, evidence, aiUsed: false };
  await writeFile(join(output, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  prepareCadReferenceDrawings(parseReferencePreparationArgs(process.argv.slice(2)), { progress: console.log }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
