import { applyPointMapPlanPatch, PointMapFormatError, type PointMapFloor, type PointMapPlan, type PresentationAffineMatrix, type PresentationAnchor } from "./point-map-plan";
import { fingerprintFloorplan, parsePointMapPresentation } from "./point-map-presentation";

export type ReferenceDrawingKind = "lighting" | "switch";
export type DrawingView = "layout" | ReferenceDrawingKind;
export const drawingViewLabels: Record<DrawingView, string> = { layout: "布局图", lighting: "灯光图", switch: "开关图" };

/** Strict portable attachments reuse the existing affine and fingerprint contract. */
export function parseReferenceDrawings(value: unknown): NonNullable<PointMapFloor["references"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PointMapFormatError("对照图格式无效。");
  const output: NonNullable<PointMapFloor["references"]> = {};
  for (const [kind, drawing] of Object.entries(value)) {
    if (kind !== "lighting" && kind !== "switch") throw new PointMapFormatError("只支持灯光图和开关图，布局图沿用工程底图。");
    output[kind] = parsePointMapPresentation(drawing, drawingViewLabels[kind]);
  }
  return output;
}

export async function resolveReferenceDrawing(floor: PointMapFloor, kind: ReferenceDrawingKind) {
  const drawing = floor.references?.[kind];
  if (!drawing) throw new PointMapFormatError(`${drawingViewLabels[kind]}尚未导入，请添加对应图纸。`);
  const parsed = parsePointMapPresentation(drawing);
  if (await fingerprintFloorplan(floor.floorplanDataUrl) !== parsed.sourceFingerprint)
    throw new PointMapFormatError(`${drawingViewLabels[kind]}的布局基准已变化，请重新配准后对照。`);
  return parsed;
}

/** Reference-image percentages back into the unchanged engineering canvas. */
export function inverseReferenceMatrix([a, b, c, d, e, f]: PresentationAffineMatrix): PresentationAffineMatrix {
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant <= 1e-8) throw new PointMapFormatError("对照图校准矩阵无效。");
  return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

/** Three or more paired building anchors, solved without an AI model or image stretching guess. */
export function fitReferenceMatrix(anchors: PresentationAnchor[]): PresentationAffineMatrix {
  if (anchors.length < 3 || anchors.length > 100) throw new PointMapFormatError("请在两张图上点选至少三个相同建筑角点。");
  const solve = (axis: "x" | "y") => {
    const rows = anchors.map(({ source, target }) => [source.x, source.y, 1, target[axis]]);
    const matrix = Array.from({ length: 3 }, (_, i) => [...Array.from({ length: 3 }, (_, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)), rows.reduce((sum, row) => sum + row[i] * row[3], 0)]);
    for (let column = 0; column < 3; column++) {
      let pivot = column;
      for (let row = column + 1; row < 3; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      if (Math.abs(matrix[column][column]) < 1e-8) throw new PointMapFormatError("三个角点不能位于同一直线上，请重新选择。");
      const scale = matrix[column][column];
      for (let j = column; j < 4; j++) matrix[column][j] /= scale;
      for (let row = 0; row < 3; row++) if (row !== column) {
        const factor = matrix[row][column];
        for (let j = column; j < 4; j++) matrix[row][j] -= factor * matrix[column][j];
      }
    }
    return matrix.map((row) => row[3]);
  };
  const x = solve("x"), y = solve("y");
  return [x[0], y[0], x[1], y[1], x[2], y[2]];
}

export async function attachReferenceDrawing(plan: PointMapPlan, floorId: string, kind: ReferenceDrawingKind,
  image: { name: string; dataUrl: string; width: number; height: number }, anchors: PresentationAnchor[]) {
  const floor = plan.floors?.find((item) => item.id === floorId);
  if (!floor?.floorplanDataUrl) throw new PointMapFormatError("先为当前楼层添加布局净底，再配准灯光和开关图。");
  const drawing = parsePointMapPresentation({ name: image.name, imageDataUrl: image.dataUrl, imageWidth: image.width, imageHeight: image.height,
    sourceFingerprint: await fingerprintFloorplan(floor.floorplanDataUrl), matrix: fitReferenceMatrix(anchors), anchors,
  });
  return applyPointMapPlanPatch(plan, { floors: plan.floors!.map((item) => item.id === floorId ? { ...item, references: { ...item.references, [kind]: drawing } } : item) });
}

export async function applyReferenceDrawingBundle(plan: PointMapPlan, value: unknown): Promise<PointMapPlan> {
  const input = value as { format?: string; version?: number; projectId?: string; floors?: Array<{ floorId: string; references: unknown }> };
  if (!input || input.format !== "fmkj-point-map-references" || input.version !== 1 || input.projectId !== plan.projectId ||
    Object.keys(input).some((key) => !["format", "version", "projectId", "floors"].includes(key)) || !Array.isArray(input.floors) || !input.floors.length || input.floors.length > 100)
    throw new PointMapFormatError("图纸包格式、版本或所属项目不符。");
  const replacements = new Map<string, NonNullable<PointMapFloor["references"]>>();
  for (const entry of input.floors) {
    if (!entry || Object.keys(entry).some((key) => !["floorId", "references"].includes(key))) throw new PointMapFormatError("图纸包楼层字段无效。");
    const floor = plan.floors?.find((item) => item.id === entry.floorId);
    if (!floor || replacements.has(entry.floorId)) throw new PointMapFormatError("图纸包包含未知或重复楼层。");
    const references = parseReferenceDrawings(entry.references);
    const fingerprint = await fingerprintFloorplan(floor.floorplanDataUrl);
    if (!floor.floorplanDataUrl || Object.values(references).some((drawing) => drawing.sourceFingerprint !== fingerprint))
      throw new PointMapFormatError("图纸包对应的布局净底已变化，请从当前楼层重新准备。");
    replacements.set(entry.floorId, references);
  }
  return applyPointMapPlanPatch(plan, { floors: plan.floors!.map((floor) => replacements.has(floor.id) ? { ...floor, references: { ...floor.references, ...replacements.get(floor.id) } } : floor) });
}
