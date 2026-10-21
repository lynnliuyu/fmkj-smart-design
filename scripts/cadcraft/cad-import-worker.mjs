#!/usr/bin/env node
/**
 * CAD → 点位草稿 的服务端入口（托管侧）。
 *
 * 一个 DWG 进来，按顺序完成：
 *   1. 复用 exportCadReview 解码 DWG、识别图框、按页渲染 PNG/PDF；
 *   2. 复用 build-floor.py 把目标布局的页面聚成楼层：干净底图 + 灯光/开关/插座参考图 + 点位；
 *   3. 产出设计站可直接导入的 fmkj-point-map-draft 草稿与核对清单。
 *
 * 不做的事：不调用 AI、不把图纸发到第三方、不自动确认点位、失败不输出半成品。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { exportCadReview } from "../export-cad-review.mjs";

const run = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * build-floor.py 需要 ezdxf/PyMuPDF，本机可能装在本地工具目录里。
 * 先探测哪个位置有模块，再把该目录放进 PYTHONPATH。与导出器用同一套查找顺序。
 */
async function pythonEnv() {
  const candidates = [join(repoRoot, ".local/cad-review/python-tools"), process.env.CAD_REVIEW_PYTHONPATH].filter(Boolean);
  const tryOrder = [here, ...candidates, process.env.PYTHONPATH].filter(Boolean).join(":");
  try {
    await run(process.env.CAD_REVIEW_PYTHON ?? "python3", ["-c", "import ezdxf, fitz"], {
      env: { ...process.env, PYTHONPATH: tryOrder }, timeout: 20_000,
    });
    return { ...process.env, PYTHONPATH: tryOrder };
  } catch {
    const message = "缺少 ezdxf / PyMuPDF，无法生成底图与点位。请安装 requirements 或设置 CAD_REVIEW_PYTHONPATH。";
    throw Object.assign(new Error(message), { code: "CAD_IMPORT_PYTHON_MISSING" });
  }
}

/** 用户指定布局时，只导出该布局；否则导出全部布局（不含 Model 总览，避免超大图超时）。 */
export function importOptions(task) {
  return {
    source: task.source,
    outDir: join(task.outDir, "pages"),
    colorMode: "readable",
    includeOverviews: false,
    space: task.space || undefined,
    cli: task.cli,
    pdftoppm: task.pdftoppm,
    python: task.python,
    pageTimeoutMs: task.pageTimeoutMs,
  };
}

/**
 * 把导出清单按楼层分组：每个页面一张“图层候选”，默认整个布局合成一层。
 * 楼层名优先用调用方给的，其次用布局名。
 */
export function floorSpecs(manifest, space, floorName) {
  const name = floorName || space || manifest.selection?.space || "一层";
  const pages = manifest.sheets.filter(page => !space || page.space === space);
  return [{ name, pages: pages.map(page => page.id) }];
}

/** 运行 build-floor.py，返回它的 summary。 */
export async function buildFloor(task, manifest, outDir, progress) {
  const [spec] = floorSpecs(manifest, task.space, task.floorName);
  if (!spec || spec.pages.length === 0) throw Object.assign(new Error("目标范围没有识别到图幅，无法生成楼层点位。"), { code: "CAD_IMPORT_NO_PAGES" });
  const floorDir = join(outDir, "floor");
  progress("正在按窗口生成底图、参考图与点位…");
  const { stdout } = await run(task.python, [
    join(here, "build-floor.py"), join(task.outDir, "pages", ".cad-import-job.json"), floorDir,
    "--floor", `${spec.name}=${spec.pages.join(",")}`,
    "--source-sha256", manifest.sourceSha256,
  ], { env: await pythonEnv(), timeout: task.timeoutMs ?? 20 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout.trim().split("\n").pop());
}

export async function runImport(task, { progress = () => {} } = {}) {
  const outDir = resolve(task.outDir);
  // 导出器要求目标目录的父目录已存在；服务端传进来的是任务目录下的 output/。
  await mkdir(outDir, { recursive: true });
  progress("正在读取 CAD 并识别图幅…");
  // 导出器会在 finally 里删掉临时目录，必须让它在清理前把渲染用 DXF 落盘。
  const preservedDxf = join(task.outDir, "source-preserved.dxf");
  const manifest = await exportCadReview(importOptions(task), { progress, keepRenderSource: preservedDxf });
  if (!manifest.sheets.length) throw Object.assign(new Error("这份图纸没有识别到逐页图幅，不能生成点位；请先核对原图图框或改用逐页导出核对。"), { code: "CAD_IMPORT_NO_PAGES" });
  // 导出器会在 finally 里删掉临时目录，所以这里必须立刻把渲染用的 DXF 复制到任务目录，
  // 否则 build-floor 拿到的是一个已被删除的路径。
  if (!manifest.renderSource) throw Object.assign(new Error("导出清单未记录渲染用 DXF，无法生成点位。"), { code: "CAD_IMPORT_NO_SOURCE" });
  const job = {
    source: preservedDxf,
    sourceLayouts: manifest.sourceLayouts ?? [],
    paperCameraHandles: manifest.paperCameraHandles ?? [],
    pages: manifest.sheets.map(page => ({ ...page, kind: "sheet" })),
  };
  await writeFile(join(task.outDir, "pages", ".cad-import-job.json"), JSON.stringify(job));
  const summary = await buildFloor(task, manifest, outDir, progress);
  const draft = JSON.parse(await readFile(join(outDir, "floor", "draft.json"), "utf8"));
  if (!draft.points?.length) throw Object.assign(new Error("没有提取到可导入的点位；灯具 / 开关图上是否存在可命名的设备图块，请人工核对。"), { code: "CAD_IMPORT_NO_POINTS" });
  await writeFile(join(outDir, "result.json"), JSON.stringify({ summary, sourceSha256: manifest.sourceSha256, fileName: task.fileName ?? null }, null, 2));
  progress(`已生成 ${draft.points.length} 个待复核点位`);
  return { summary, draft };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  try {
    const task = JSON.parse(process.argv[2]);
    const result = await runImport(task, { progress: message => console.log(message) });
    process.stdout.write(JSON.stringify(result.summary) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { rm };
