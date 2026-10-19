import { describe, expect, it } from "vitest";
import { applyReferenceDrawingBundle, attachReferenceDrawing, fitReferenceMatrix, inverseReferenceMatrix, parseReferenceDrawings, resolveReferenceDrawing } from "../lib/point-map-reference-drawings";
import { emptyPointMapPlan, type PresentationAnchor } from "../lib/point-map-plan";
import { exportPointMapDraft, normalizeDesignPlan, parsePointMapDraft, validateDesignPlan } from "../lib/point-map-design";
import { applyPointMapFloorplanCrop } from "../lib/point-map-floorplan-crop";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const anchors: PresentationAnchor[] = [{ source: { x: 15, y: 15 }, target: { x: 22, y: 22 } }, { source: { x: 85, y: 15 }, target: { x: 78, y: 22 } }, { source: { x: 15, y: 85 }, target: { x: 22, y: 78 } }, { source: { x: 85, y: 85 }, target: { x: 78, y: 78 } }];
function fixture() { return normalizeDesignPlan({ ...emptyPointMapPlan("reference-project"), floorplanName: "layout.png", floorplanDataUrl: png,
  floors: [{ id: "f1", name: "全屋", floorplanName: "layout.png", floorplanDataUrl: png, imageWidth: 1000, imageHeight: 1000 }], activeFloorId: "f1" }); }
const position = (matrix: number[], p: { x: number; y: number }) => ({ x: matrix[0] * p.x + matrix[2] * p.y + matrix[4], y: matrix[1] * p.x + matrix[3] * p.y + matrix[5] });

describe("calibrated layout, lighting and switch references", () => {
  it("fits dispersed paired anchors and projects back into the same engineering canvas", () => {
    const matrix = fitReferenceMatrix(anchors);
    const inverse = inverseReferenceMatrix(matrix);
    for (const anchor of anchors) {
      expect(position(matrix, anchor.source).x).toBeCloseTo(anchor.target.x, 8);
      expect(position(inverse, anchor.target).y).toBeCloseTo(anchor.source.y, 8);
    }
    expect(() => fitReferenceMatrix(anchors.slice(0, 2))).toThrow();
    expect(() => fitReferenceMatrix([anchors[0], anchors[0], anchors[0]])).toThrow(/同一直线/);
  });
  it("adds references without replacing the layout, point data or CAD source, and survives portable export", async () => {
    const plan = fixture(), before = structuredClone(plan);
    const next = await attachReferenceDrawing(plan, "f1", "lighting", { name: "灯光.png", dataUrl: png, width: 1000, height: 1000 }, anchors);
    const drawing = await resolveReferenceDrawing(next.floors![0], "lighting");
    expect(drawing.matrix[0]).toBeCloseTo(.8);
    expect(next.floorplanDataUrl).toBe(png);
    expect(next.points).toBe(plan.points);
    expect(validateDesignPlan(next).floors![0].references).toEqual(next.floors![0].references);
    expect(parsePointMapDraft(exportPointMapDraft(next)).floors[0].references).toEqual(next.floors![0].references);
    expect(plan).toEqual(before);
    await expect(resolveReferenceDrawing({ ...next.floors![0], floorplanDataUrl: png + "changed" }, "lighting")).rejects.toThrow(/基准已变化/);
  });
  it("imports a project-specific bundle atomically and rejects stale, cross-project and unknown drawings", async () => {
    const plan = fixture();
    const example = await attachReferenceDrawing(plan, "f1", "switch", { name: "开关.png", dataUrl: png, width: 1000, height: 1000 }, anchors);
    const bundle = { format: "fmkj-point-map-references", version: 1, projectId: plan.projectId, floors: [{ floorId: "f1", references: example.floors![0].references }] };
    expect((await applyReferenceDrawingBundle(plan, bundle)).floors![0].references).toEqual(example.floors![0].references);
    await expect(applyReferenceDrawingBundle(plan, { ...bundle, projectId: "other" })).rejects.toThrow(/所属项目/);
    await expect(applyReferenceDrawingBundle(plan, { ...bundle, floors: [...bundle.floors, ...bundle.floors] })).rejects.toThrow(/重复/);
    await expect(applyReferenceDrawingBundle({ ...plan, floors: [{ ...plan.floors![0], floorplanDataUrl: png + "changed" }] }, bundle)).rejects.toThrow(/净底已变化/);
    expect(() => parseReferenceDrawings({ elevation: example.floors![0].references!.switch })).toThrow(/只支持/);
  });
  it("rebases existing reference calibration with a layout crop without moving the referenced position", async () => {
    const next = await attachReferenceDrawing(fixture(), "f1", "switch", { name: "开关.png", dataUrl: png, width: 1000, height: 1000 }, anchors);
    const crop = { left: 100, top: 100, width: 800, height: 800 };
    const cropped = await applyPointMapFloorplanCrop(next, "f1", png, crop, { dataUrl: png, width: 3000, height: 3000 });
    const drawing = await resolveReferenceDrawing(cropped.floors![0], "switch");
    expect(position(drawing.matrix, { x: 50, y: 50 }).x).toBeCloseTo(position(next.floors![0].references!.switch!.matrix, { x: 50, y: 50 }).x);
    expect(cropped.floors![0].references!.switch!.anchors[0].target).toEqual(anchors[0].target);
  });
});
