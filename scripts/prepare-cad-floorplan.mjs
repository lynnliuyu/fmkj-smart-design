#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { POINT_MAP_IMAGE_LONG_EDGE, pointMapImageSize } from "../lib/point-map-image-size.mjs";
import { cropCadWindow, findFloorplanCrop, validateFloorplanCrop } from "../lib/point-map-crop-geometry.mjs";
import { BASE_LAYER, queryAll, sha256 } from "./cadcraft/bridge.mjs";
import { CadcraftClient } from "./cadcraft/mcp-client.mjs";

export const MAX_CAD_SVG_BYTES = 40_000_000;
const COMMAND_TIMEOUT_MS = 55_000;
const TOTAL_TIMEOUT_MS = 5 * 60_000;
const PNG_LONG_EDGE = POINT_MAP_IMAGE_LONG_EDGE;
const STROKE_PIXELS = 1.6;
const runFile = promisify(execFile);

export const usage = `本机 CAD 净底准备（Node.js 24+，CADCraft CLI）
node scripts/prepare-cad-floorplan.mjs --source original.dwg --out-dir new-output --window x0,y0,x1,y1 [--hide-layers layers.json] [--crop-frame prior/manifest.json] [--cli /path/cadcraft-cli]
窗口为 CAD Y-up 坐标；只选窗口内的完整实体，不裁断跨界实体。
layers.json 只能包含需删除的图层名称数组。CLI 也可使用 CADCRAFT_CLI。
自动裁去外围空纸，保留 3% 安全边距，长边 3000px。相关图用 --crop-frame 复用同一原图、同一坐标窗口的裁切，不能各自裁切。
输出目录必须尚不存在；原图仅读，输出 clean-base.dxf / .svg / .png 与 manifest.json。`;

export function parseCadPreparationArgs(args) {
  if (args.length === 1 && ["--help", "help"].includes(args[0])) return { help: true };
  const allowed = new Set(["--source", "--out-dir", "--window", "--hide-layers", "--crop-frame", "--cli"]);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!allowed.has(name) || Object.hasOwn(flags, name) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`无效、重复或缺值参数：${name}\n${usage}`);
    flags[name] = args[i + 1];
  }
  for (const flag of ["--source", "--out-dir", "--window"])
    if (!flags[flag]) throw new Error(`缺少参数 ${flag}\n${usage}`);
  return {
    source: flags["--source"], outDir: flags["--out-dir"],
    window: parseCadWindow(flags["--window"]),
    hideLayersPath: flags["--hide-layers"], cropFramePath: flags["--crop-frame"], cli: flags["--cli"],
  };
}

export function parseCadWindow(value) {
  const parts = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(parts) || parts.length !== 4 || parts.some((part) => typeof part === "string" && !part.trim()))
    throw new Error("--window 必须包含 x0,y0,x1,y1 四个有限坐标。");
  const window = parts.map(Number);
  if (window.some((part) => !Number.isFinite(part) || Math.abs(part) > 1e12) ||
    window[2] - window[0] < 1e-6 || window[3] - window[1] < 1e-6)
    throw new Error("--window 范围无效，要求 x1 > x0、y1 > y0，坐标不超过 ±1e12。");
  return window;
}

export function parseHiddenCadLayers(value) {
  if (!Array.isArray(value) || value.length > 1000 || value.some((name) =>
    typeof name !== "string" || !name.trim() || name.length > 255 || /[\u0000-\u001f]/.test(name)))
    throw new Error("隐藏图层文件必须是最多 1000 个有效图层名称组成的 JSON 数组。");
  return [...new Set(value)];
}

function dimensionsForWindow(window) {
  const width = window[2] - window[0], height = window[3] - window[1];
  return pointMapImageSize(width, height);
}

/** CADCraft emits simple local vector geometry. Reject active/external SVG content. */
export function normalizeCadFloorplanSvg(input, windowValue) {
  const window = parseCadWindow(windowValue);
  if (Buffer.byteLength(input, "utf8") > MAX_CAD_SVG_BYTES)
    throw new Error("SVG 超过 40 MB，请收紧窗口范围或补充需隐藏的图层后重试。");
  const svg = String(input).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
  const root = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i.exec(svg);
  if (!root) throw new Error("CADCraft 未输出完整 SVG。");
  if (/<!|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(/i.test(svg))
    throw new Error("SVG 包含外部引用或活动内容，未加载该内容。");
  const tags = [...svg.matchAll(/<\/?([\w:-]+)/g)].map((match) => match[1]);
  const allowed = new Set(["svg", "g", "path", "polyline", "polygon", "line", "rect", "circle", "ellipse"]);
  if (tags.some((tag) => !allowed.has(tag))) throw new Error("SVG 包含非工程几何内容，请先清理图纸。");
  const viewBoxMatch = /\bviewBox\s*=\s*["']([^"']+)["']/.exec(root[1]);
  const viewBox = viewBoxMatch?.[1].trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((part) => !Number.isFinite(part)) || viewBox[2] <= 0 || viewBox[3] <= 0)
    throw new Error("SVG 缺少有效 viewBox，无法验证 CAD 窗口比例。");
  const ratio = (window[2] - window[0]) / (window[3] - window[1]);
  if (Math.abs(viewBox[2] / viewBox[3] / ratio - 1) > 0.00001)
    throw new Error("SVG 比例与 --window 不一致，停止生成以免底图坐标错位。");
  const dimensions = dimensionsForWindow(window);
  const stroke = Math.max(viewBox[2], viewBox[3]) / PNG_LONG_EDGE * STROKE_PIXELS;
  // The exporter adds one canvas-sized rect before the actual CAD geometry.
  let body = root[2].replace(/^\s*<rect\b(?=[^>]*\bwidth=["']100%["'])(?=[^>]*\bheight=["']100%["'])[^>]*\/?>\s*(?:<\/rect>\s*)?/i, "");
  body = body
    .replace(/\b(fill|stroke)\s*=\s*(["'])(.*?)\2/gi, (_all, name, _quote, value) => `${name}="${value.trim().toLowerCase() === "none" ? "none" : "#000000"}"`)
    .replace(/\b(fill-opacity|stroke-opacity|opacity)\s*=\s*(["']).*?\2/gi, (_all, name) => `${name}="1"`)
    .replace(/\bstroke-width\s*=\s*(["']).*?\1/gi, `stroke-width="${stroke}"`)
    .replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_all, _quote, style) => {
      if (/[^\w\s:#.,%();-]/.test(style)) throw new Error("SVG 样式无效。");
      const normalized = style.replace(/(^|;)\s*(fill|stroke)\s*:\s*([^;]+)/gi, (_entry, prefix, name, value) =>
        `${prefix}${name}:${value.trim().toLowerCase() === "none" ? "none" : "#000000"}`)
        .replace(/(^|;)\s*(?:fill-opacity|stroke-opacity|opacity)\s*:\s*[^;]+/gi, "$1opacity:1")
        .replace(/(^|;)\s*stroke-width\s*:\s*[^;]+/gi, `$1stroke-width:${stroke}`);
      return `style="${normalized}"`;
    });
  const background = `<rect data-fmkj-background="true" x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="#ffffff"/>`;
  const output = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}" width="${dimensions.width}" height="${dimensions.height}">${background}<g fill="#000000" color="#000000" stroke-width="${stroke}" opacity="1">${body}</g></svg>`;
  if (Buffer.byteLength(output, "utf8") > MAX_CAD_SVG_BYTES)
    throw new Error("SVG 超过 40 MB，请收紧窗口范围或补充需隐藏的图层后重试。");
  return {
    svg: output,
    ...dimensions, strokePixels: STROKE_PIXELS,
  };
}

export async function rasterizeCadFloorplan(svg, output) {
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(svg)).timeout({ seconds: 55 }).flatten({ background: "#ffffff" }).removeAlpha().png().toFile(output);
}

/** Raster bounds decide a vector viewBox; rerender vectors to keep the final lines sharp. */
export async function compactCadFloorplanSvg(visual, window, frame) {
  const { default: sharp } = await import("sharp");
  const pixels = await sharp(Buffer.from(visual.svg)).timeout({ seconds: 55 }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = pixels.info;
  const detected = findFloorplanCrop(pixels.data, width, height, channels);
  const crop = frame ? validateFloorplanCrop(frame, width, height) : detected;
  if (frame && (crop.left > detected.left || crop.top > detected.top || crop.left + crop.width < detected.left + detected.width || crop.top + crop.height < detected.top + detected.height))
    throw new Error("共用裁切范围无法完整容纳本图，请重新确认三类图的共同范围。");
  const viewBox = /viewBox="([^"]+)"/.exec(visual.svg)[1].split(/\s+/).map(Number);
  const box = [viewBox[0] + crop.left / width * viewBox[2], viewBox[1] + crop.top / height * viewBox[3], crop.width / width * viewBox[2], crop.height / height * viewBox[3]];
  const nextWindow = cropCadWindow(window, crop, width, height);
  const size = dimensionsForWindow(nextWindow);
  const stroke = Math.max(box[2], box[3]) / PNG_LONG_EDGE * STROKE_PIXELS;
  const svg = visual.svg.replace(/viewBox="[^"]+" width="[^"]+" height="[^"]+"/, `viewBox="${box.join(" ")}" width="${size.width}" height="${size.height}"`)
    .replace(/stroke-width="[^"]+"/g, `stroke-width="${stroke}"`)
    .replace(/stroke-width:[^;"']+/g, `stroke-width:${stroke}`);
  return { svg, ...size, strokePixels: STROKE_PIXELS, window: nextWindow,
    crop: { ...crop, sourceImage: { width, height }, padding: 0.03 } };
}

function entityKind(entity) {
  return String(entity.type ?? "").replace(/[\s_-]/g, "").toLowerCase();
}
function removalReason(entity, hiddenLayers) {
  if (hiddenLayers.has(entity.layer)) return "hiddenLayer";
  if (entity.visible === false || entity.invisible === true) return "invisible";
  const kind = entityKind(entity);
  if (["text", "mtext", "dimension", "leader", "mleader", "multileader", "attributedefinition", "attdef", "attribute", "attrib", "table"].includes(kind)) return "annotation";
  if (["rasterimage", "image"].includes(kind)) return "raster";
  if (kind === "hatch" && entity.geometry?.solid !== true) return "patternHatch";
  return null;
}
function handles(entities) {
  const values = entities.map((entity) => entity.handle);
  if (values.some((handle) => typeof handle !== "string" || !handle) || new Set(values).size !== values.length)
    throw new Error("CAD 实体缺少唯一 handle，停止清理。");
  return values;
}
async function chunks(items, action) {
  for (let start = 0; start < items.length; start += 1000) await action(items.slice(start, start + 1000));
}
async function newDirectory(outDir) {
  const candidate = resolve(outDir);
  await mkdir(dirname(candidate), { recursive: true });
  const output = join(await realpath(dirname(candidate)), basename(candidate));
  try { await lstat(output); throw new Error(`输出目录已存在，请使用新目录：${output}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Exclusive mkdir also rejects a file/symlink created after the check.
  try { await mkdir(output); }
  catch (error) { if (error.code === "EEXIST") throw new Error(`输出目录已存在，请使用新目录：${output}`); throw error; }
  return output;
}

/** Every mutation targets a private derived DXF. No database or network is used. */
export async function prepareCadFloorplan(options, dependencies = {}) {
  const window = parseCadWindow(options.window);
  const source = await realpath(resolve(options.source));
  if (!/\.(dwg|dxf)$/i.test(source) || !(await lstat(source)).isFile()) throw new Error("--source 必须是本机 DWG 或 DXF 文件。");
  const sourceBytes = await readFile(source);
  const sourceSha256 = sha256(sourceBytes);
  let frame;
  if (options.cropFramePath) {
    if ((await stat(options.cropFramePath)).size > 1024 * 1024) throw new Error("共用裁切清单超过 1 MB。");
    const previous = JSON.parse(await readFile(options.cropFramePath, "utf8"));
    if (previous.format !== "fmkj-cad-floorplan" || previous.source?.sha256 !== sourceSha256 ||
      JSON.stringify(previous.selectionWindow) !== JSON.stringify(window) || !previous.crop)
      throw new Error("共用裁切清单必须来自同一原图、同一坐标窗口。");
    const expected = dimensionsForWindow(window);
    if (previous.crop.sourceImage?.width !== expected.width || previous.crop.sourceImage?.height !== expected.height)
      throw new Error("共用裁切清单的源图尺寸不符。");
    frame = validateFloorplanCrop(previous.crop, expected.width, expected.height);
  }
  let hideLayers = [];
  if (options.hideLayersPath) {
    if ((await stat(options.hideLayersPath)).size > 1024 * 1024) throw new Error("隐藏图层 JSON 文件超过 1 MB。");
    let json;
    try { json = JSON.parse(await readFile(options.hideLayersPath, "utf8")); }
    catch { throw new Error("隐藏图层文件不是有效 JSON 数组。"); }
    hideLayers = parseHiddenCadLayers(json);
  }
  const outDir = await newDirectory(options.outDir);
  const staging = await mkdtemp(join(outDir, ".fmkj-cad-"));
  const copiedSource = join(staging, `source${extname(source).toLowerCase()}`);
  const region = join(staging, "region.dxf");
  const dxf = join(staging, "clean-base.dxf"), rawSvg = join(staging, "raw.svg");
  const svg = join(staging, "clean-base.svg"), png = join(staging, "clean-base.png");
  const cli = options.cli ?? process.env.CADCRAFT_CLI ?? "cadcraft-cli";
  const timeoutMs = dependencies.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const abort = new AbortController();
  let client, timer, failure, manifest;
  let timedOut = false;
  const check = () => { if (timedOut) throw new Error("CAD 净底准备总时限已到，请收紧范围后重试。"); };
  try {
    await writeFile(copiedSource, sourceBytes, { flag: "wx", mode: 0o400 });
    await chmod(copiedSource, 0o400);
    client = (dependencies.createClient ?? ((executable, settings) => new CadcraftClient(executable, settings)))(cli, { timeoutMs });
    const call = async (fn) => { check(); const result = await fn(); check(); return result; };
    const session = {
      tool: (name, params) => call(() => client.tool(name, params)),
      execute: (command, params) => call(() => client.execute(command, params)),
    };
    const work = async () => {
      await call(() => client.initialize());
      await session.tool("open", { path: copiedSource });
      const selected = await queryAll(session, { window: [window.slice(0, 2), window.slice(2)], crossing: false });
      if (!selected.length) throw new Error("窗口内没有完整 CAD 实体，请检查窗口或放宽边界。");
      await session.execute("wblock", { path: region, handles: handles(selected), base: [0, 0] });
      await session.tool("open", { path: region });
      const original = await session.tool("inspect_drawing");
      if (!Array.isArray(original.layers) || original.layers.some((layer) =>
        typeof layer.name !== "string" || !layer.name ||
        typeof layer.on !== "boolean" || typeof layer.frozen !== "boolean" || typeof layer.locked !== "boolean"))
        throw new Error("CAD 图层状态不完整，停止清理。");
      const hidden = new Set([...hideLayers, ...original.layers.filter((layer) => layer.on === false || layer.frozen === true).map((layer) => layer.name)]);
      // Unlock only the derived drawing; remember visibility before changing anything.
      for (const layer of original.layers) if (layer.locked) await session.execute("layer.set", { name: layer.name, locked: false });
      const counts = { selected: selected.length, explodeRounds: [], removed: 0, removedByReason: {}, kept: 0, keptByType: {} };
      let live = [];
      for (let depth = 0; depth <= 8; depth++) {
        const entities = await queryAll(session);
        const remove = [], keep = [];
        for (const entity of entities) {
          const reason = removalReason(entity, hidden);
          if (reason) { remove.push(entity); counts.removedByReason[reason] = (counts.removedByReason[reason] ?? 0) + 1; }
          else keep.push(entity);
        }
        counts.removed += remove.length;
        await chunks(handles(remove), (values) => session.execute("erase", { handles: values }));
        const blocks = keep.filter((entity) => ["insert", "blockreference"].includes(entityKind(entity)));
        if (!blocks.length) { live = keep; break; }
        if (depth === 8) throw new Error("嵌套图块超过 8 层，请先简化图块后重试。");
        counts.explodeRounds.push(blocks.length);
        await chunks(handles(blocks), (values) => session.execute("explode", { handles: values }));
      }
      if (!live.length) throw new Error("清理后没有可见工程几何，请核对隐藏图层和窗口。");
      if (original.layers.some((layer) => layer.name === BASE_LAYER))
        await session.execute("layer.set", { name: BASE_LAYER, locked: false, on: true, frozen: false, color: "0,0,0", transparency: 0, lineweight: 0.18, plot: true });
      else await session.execute("layer.new", { name: BASE_LAYER, color: "0,0,0", current: true, lineweight: 0.18 });
      // query_entities can omit entity visibility. Preserve native hidden furniture
      // variants rather than assuming missing flags mean they may be shown.
      await chunks(handles(live), (values) => session.execute("properties.set", { handles: values, layer: BASE_LAYER, color: "ByLayer" }));
      await session.execute("layer.current", { name: BASE_LAYER });
      for (const layer of original.layers)
        if (layer.name !== BASE_LAYER && layer.on)
          await session.execute("layer.set", { name: layer.name, on: false });
      await session.execute("layer.set", { name: BASE_LAYER, locked: true, on: true, frozen: false, color: "0,0,0", transparency: 0, plot: true });
      const final = await session.tool("inspect_drawing");
      const base = final.layers?.find((layer) => layer.name === BASE_LAYER);
      if (base?.locked !== true || base.on !== true || base.frozen !== false) throw new Error("净底图层未能锁定或显示，停止导出。");
      if (final.layers.some((layer) => layer.name !== BASE_LAYER && layer.on !== false))
        throw new Error("净底仍有其他开启图层，停止导出。");
      const finalEntities = await queryAll(session);
      if (finalEntities.length !== live.length || finalEntities.some((entity) => entity.layer !== BASE_LAYER || removalReason(entity, new Set())))
        throw new Error("净底实体清理不完整，停止导出。");
      counts.kept = finalEntities.length;
      for (const entity of finalEntities) counts.keptByType[entity.type] = (counts.keptByType[entity.type] ?? 0) + 1;
      await session.tool("save", { path: dxf });
      if (dependencies.convert) await dependencies.convert({ cli, dxf, svg: rawSvg, window, timeoutMs, signal: abort.signal });
      else await runFile(cli, ["convert", dxf, rawSvg, "--window", window.join(",")], { timeout: timeoutMs, maxBuffer: 1024 * 1024, killSignal: "SIGKILL", signal: abort.signal, shell: false });
      check();
      if ((await stat(rawSvg)).size > MAX_CAD_SVG_BYTES) throw new Error("SVG 超过 40 MB，请收紧窗口范围或补充需隐藏的图层后重试。");
      const visual = await compactCadFloorplanSvg(normalizeCadFloorplanSvg(await readFile(rawSvg, "utf8"), window), window, frame);
      await writeFile(svg, visual.svg, { flag: "wx" });
      await (dependencies.rasterize ?? rasterizeCadFloorplan)(visual.svg, png);
      check();
      const dxfSha256 = sha256(await readFile(dxf)), backgroundSha256 = sha256(await readFile(png));
      manifest = {
        format: "fmkj-cad-floorplan", version: 1,
        createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
        source: { path: source, sha256: sourceSha256, bytes: sourceBytes.length, preserved: true },
        selectionWindow: window, window: visual.window, crop: visual.crop, coordinateSystem: "cad-y-up", selection: "entirely-inside-window", hiddenLayers: hideLayers,
        cad: { format: "cadcraft", version: 1, drawingId: `cad-${sha256(`${dxfSha256}:${visual.window.join(",")}`).slice(0, 24)}`, drawingSha256: dxfSha256, window: visual.window },
        backgroundSha256, image: { width: visual.width, height: visual.height, background: "#ffffff", geometry: "#000000", strokePixels: visual.strokePixels },
        counts,
        files: { dxf: "clean-base.dxf", svg: "clean-base.svg", png: "clean-base.png" },
      };
      if (sha256(await readFile(source)) !== sourceSha256) throw new Error("原图指纹已改变，停止发布净底；请检查外部修改。");
      for (const name of Object.values(manifest.files))
        await copyFile(join(staging, name), join(outDir, name), constants.COPYFILE_EXCL);
    };
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true; abort.abort(); void client.close();
          reject(new Error("CAD 净底准备超过总时限，请收紧范围后重试。"));
        }, totalTimeoutMs);
      }),
    ]);
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timer);
    abort.abort();
    try { await client?.close(); } catch (error) { failure ??= error; }
    try { await rm(staging, { recursive: true, force: true }); } catch (error) { failure ??= error; }
    try {
      if (sha256(await readFile(source)) !== sourceSha256)
        failure = new Error("原图指纹已改变，净底未获原图保护验证；请检查外部修改。", { cause: failure });
    } catch (error) { failure = new Error("原图已无法读取，未通过原图保护验证。", { cause: error }); }
  }
  if (failure) throw failure;
  // This completion marker is written only after session close and source recheck.
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { outDir, ...manifest };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseCadPreparationArgs(args);
  if (options.help) { console.log(usage); return; }
  console.log(JSON.stringify(await prepareCadFloorplan(options), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => { console.error(`CAD 净底准备失败：${error.message}`); process.exitCode = 1; });
