import { POINT_MAP_IMAGE_LONG_EDGE } from "../../lib/point-map-image-size.mjs";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isPaperViewportCamera } from "./viewport-source.mjs";
const run = promisify(execFile);

export async function renderClippedCadReview(manifest, source, viewportSource, staging, outDir, python, progress = () => {}) {
  const localModules = fileURLToPath(new URL("../../.local/cad-review/python-tools", import.meta.url));
  const env = { ...process.env, PYTHONPATH: [localModules, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
  try { await run(python, ["-c", "import ezdxf,fitz"], { env, timeout: 10_000 }); }
  catch { throw new Error("原图包含图块裁剪，需先安装本机导出依赖：Python pip install -r scripts/cadcraft/render-requirements.txt；不能用忽略裁剪的图纸代替。"); }
  const jobPath = join(staging, "render-job.json"), resultPath = join(staging, "render-result.json");
  await writeFile(jobPath, JSON.stringify({ source, outDir, imageLongEdge: POINT_MAP_IMAGE_LONG_EDGE, colorMode: manifest.colorMode, sourceLayouts: viewportSource.sourceLayouts ?? [], expectedSpatialFilters: viewportSource.spatialFilterCount ?? 0, paperCameraHandles: [...viewportSource.viewports.values()].filter(isPaperViewportCamera).map(v => v.handle), pages: [...manifest.overviews, ...manifest.sheets] }));
  progress("正在按原始视口与图块裁剪生成逐页资料…");
  await run(python, [fileURLToPath(new URL("./render-clipped-review.py", import.meta.url)), jobPath, resultPath], { env, timeout: 40 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(await readFile(resultPath, "utf8"));
}
