import { POINT_MAP_IMAGE_LONG_EDGE } from "../../lib/point-map-image-size.mjs";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isPaperViewportCamera } from "./viewport-source.mjs";
const run = promisify(execFile);

export async function renderClippedCadReview(manifest, source, viewportSource, staging, outDir, python, progress = () => {}, options = {}) {
  const localModules = fileURLToPath(new URL("../../.local/cad-review/python-tools", import.meta.url));
  const env = { ...process.env, PYTHONPATH: [localModules, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
  try { await run(python, ["-c", "import ezdxf,fitz; assert ezdxf.version >= (1,4,5,'release')"], { env, timeout: 10_000 }); }
  catch { throw new Error("原图包含图块裁剪，需安装或更新本机导出依赖（ezdxf 至少 1.4.5）：Python pip install -r scripts/cadcraft/render-requirements.txt；不能用忽略裁剪的图纸代替。"); }
  const jobPath = join(staging, "render-job.json"), resultPath = join(staging, "render-result.json");
  await writeFile(jobPath, JSON.stringify({ source, outDir, fallbackFont: process.env.CAD_REVIEW_FALLBACK_FONT, imageLongEdge: POINT_MAP_IMAGE_LONG_EDGE, colorMode: manifest.colorMode, previewOnly: manifest.previewOnly === true, sourceLayouts: viewportSource.sourceLayouts ?? [], expectedSpatialFilters: viewportSource.spatialFilterCount ?? 0, paperCameraHandles: [...viewportSource.viewports.values()].filter(isPaperViewportCamera).map(v => v.handle), pages: [...manifest.overviews, ...manifest.sheets] }));
  progress("正在按原始视口与图块裁剪生成逐页资料…");
  const rendering = run(python, ["-u", fileURLToPath(new URL("./render-clipped-review.py", import.meta.url)), jobPath, resultPath], { env, timeout: 40 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  let pending = "", pageTimer, timedOut = false, currentPage = "";
  rendering.child.stdout.on("data", chunk => {
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
      if (line.startsWith("CAD_STAGE ")) progress(line.slice(10));
      else if (line.startsWith("Rendering ")) {
        currentPage = line.slice(10); progress(`正在渲染 ${currentPage}…`);
        clearTimeout(pageTimer);
        if (options.pageTimeoutMs) pageTimer = setTimeout(() => { timedOut = true; rendering.child.kill("SIGTERM"); }, options.pageTimeoutMs);
      }
      else if (line.startsWith("Done ")) { clearTimeout(pageTimer); progress(`已生成 ${line.slice(5)}`); }
    }
  });
  let stdout;
  try { ({ stdout } = await rendering); }
  catch (error) {
    if (timedOut) throw Object.assign(new Error(`${currentPage} 单页渲染超过 ${Math.round(options.pageTimeoutMs / 1000)} 秒，已停止；这份图暂不适合当前快速导出路径，建议改用原 CAD 批量出版引擎。`), { code: "CAD_RENDER_BUDGET" });
    throw error;
  } finally { clearTimeout(pageTimer); }
  if (/hatching timeout.*aborting/i.test(stdout)) throw new Error("原图填充渲染超时，不能将不完整填充作为成功结果，请复核图纸。");
  return JSON.parse(await readFile(resultPath, "utf8"));
}
