import { applyPointMapPlanPatch, type PointMapPlan, type PointMapPosition, type PointMapPresentation, type PresentationAffineMatrix } from "./point-map-plan";
import { activePointMapFloor } from "./point-map-design";
import { fingerprintFloorplan, parsePointMapPresentation } from "./point-map-presentation";
import { cropCadWindow, cropPercentPosition, findFloorplanCrop, validateFloorplanCrop } from "./point-map-crop-geometry.mjs";
import { pointMapImageSize } from "./point-map-image-size.mjs";
import { parseCadBinding } from "./point-map-cad-contract";

export type FloorplanCrop = { left: number; top: number; width: number; height: number };

/** The backup can yield to new edits or navigation; check again before replacing the draft. */
export async function commitPointMapFloorplanCrop({
  before, next, floorId, source, current, backup, apply,
}: {
  before: PointMapPlan;
  next: PointMapPlan;
  floorId: string;
  source: string;
  current: () => { plan: PointMapPlan; projectId: string; editingDisabled: boolean };
  backup: () => Promise<boolean>;
  apply: (plan: PointMapPlan) => void;
}) {
  function assertCurrent() {
    const context = current();
    const floor = activePointMapFloor(context.plan);
    if (
      context.plan !== before ||
      context.projectId !== before.projectId ||
      floor?.id !== floorId ||
      floor.floorplanDataUrl !== source ||
      context.editingDisabled
    ) throw new Error("整理期间草稿、楼层或编辑权限已变化，请在当前草稿上重试。");
  }
  assertCurrent();
  const backupStored = await backup();
  assertCurrent();
  apply(next);
  return backupStored;
}

/** Atomic coordinate migration: preserve actual CAD positions and presentation calibration. */
export async function applyPointMapFloorplanCrop(plan: PointMapPlan, floorId: string, expectedSource: string, crop: FloorplanCrop,
  image: { dataUrl: string; width: number; height: number }): Promise<PointMapPlan> {
  const floor = plan.floors?.find((item) => item.id === floorId);
  if (!floor || floor.floorplanDataUrl !== expectedSource) throw new Error("底图已变化，请重新整理留白。");
  const { imageWidth: width, imageHeight: height } = floor;
  validateFloorplanCrop(crop, width, height);
  const size = pointMapImageSize(crop.width, crop.height);
  if (image.width !== size.width || image.height !== size.height || !image.dataUrl.startsWith("data:image/png;base64,"))
    throw new Error("裁切图片必须按统一的 3000 像素长边生成。");
  const position = (point: PointMapPosition) => {
    const mapped = cropPercentPosition(point, crop, width, height);
    if (mapped.x < 0 || mapped.x > 100 || mapped.y < 0 || mapped.y > 100) throw new Error("外围存在点位或校准锚点，裁切会超出范围，请先核对；原图与点位保留。");
    return mapped;
  };
  const rebase = async (presentation: PointMapPresentation) => {
    if (await fingerprintFloorplan(expectedSource) !== presentation.sourceFingerprint) throw new Error("风格底图校准已失效，请先重新校准。");
    const [a, b, c, d, e, f] = presentation.matrix;
    const sx = crop.width / width, sy = crop.height / height;
    const ox = crop.left / width * 100, oy = crop.top / height * 100;
    const matrix: PresentationAffineMatrix = [a * sx, b * sx, c * sy, d * sy, e + a * ox + c * oy, f + b * ox + d * oy];
    return parsePointMapPresentation({ ...presentation, matrix,
      sourceFingerprint: await fingerprintFloorplan(image.dataUrl),
      anchors: presentation.anchors.map((anchor) => ({ ...anchor, source: position(anchor.source) })),
    });
  };
  const presentation = floor.presentation ? await rebase(floor.presentation) : undefined;
  const references = floor.references ? Object.fromEntries(await Promise.all(Object.entries(floor.references).map(async ([kind, drawing]) => [kind, await rebase(drawing)]))) : undefined;
  const points = plan.points.map((point) => {
    if (point.floorId !== floorId || !point.placed) return point;
    // Display offsets use presentation percentages when a presentation is attached.
    const display = point.display && !presentation ? {
      markerOffset: { x: point.display.markerOffset.x * width / crop.width, y: point.display.markerOffset.y * height / crop.height },
      labelOffset: { x: point.display.labelOffset.x * width / crop.width, y: point.display.labelOffset.y * height / crop.height },
    } : point.display;
    if (display && [display.markerOffset, display.labelOffset].some((offset) => Math.abs(offset.x) > 20 || Math.abs(offset.y) > 20))
      throw new Error("裁切后的商品展示偏移超出范围，请先收回展示偏移。");
    return { ...point, ...position(point), ...(display ? { display } : {}) };
  });
  const cad = floor.cad ? parseCadBinding({ ...floor.cad, window: cropCadWindow(floor.cad.window, crop, width, height) }) : undefined;
  return applyPointMapPlanPatch(plan, {
    floors: plan.floors!.map((item) => item.id === floorId ? { ...item, floorplanDataUrl: image.dataUrl, imageWidth: image.width, imageHeight: image.height, cad, presentation, references } : item),
    points,
    ...(plan.activeFloorId === floorId ? { floorplanDataUrl: image.dataUrl } : {}),
  });
}

/** Explicit action on an existing clean base; no AI, upload or database write. */
export async function compactPointMapFloorplan(source: string) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const width = image.naturalWidth, height = image.naturalHeight;
  if (width * height > 36_000_000) throw new Error("底图超过 3600 万像素，请先缩小。");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法处理图片。");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0);
  const crop = findFloorplanCrop(context.getImageData(0, 0, width, height).data, width, height);
  const size = pointMapImageSize(crop.width, crop.height);
  const output = document.createElement("canvas");
  output.width = size.width; output.height = size.height;
  const target = output.getContext("2d");
  if (!target) throw new Error("浏览器无法处理图片。");
  target.fillStyle = "#ffffff"; target.fillRect(0, 0, size.width, size.height);
  target.drawImage(canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, size.width, size.height);
  return { crop, image: { dataUrl: output.toDataURL("image/png"), ...size }, sourceSize: { width, height } };
}
