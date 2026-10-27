import { describe, expect, it, vi } from "vitest";
import { cropPercentPosition, findFloorplanCrop } from "../lib/point-map-crop-geometry.mjs";
import { applyPointMapFloorplanCrop, commitPointMapFloorplanCrop } from "../lib/point-map-floorplan-crop";
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan";
import { fingerprintFloorplan, resolvePointMapBackground } from "../lib/point-map-presentation";
import { percentToCad } from "../lib/point-map-cad-contract";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const crop = { left: 100, top: 100, width: 800, height: 800 };
const image = { dataUrl: png, width: 3000, height: 3000 };
async function fixture(presentation = true): Promise<PointMapPlan> {
  return { ...emptyPointMapPlan("crop-project"), schemaVersion: 3, activeFloorId: "one", floorplanDataUrl: png,
    floors: [{ id: "one", name: "一楼", floorplanName: "净底.png", floorplanDataUrl: png, imageWidth: 1000, imageHeight: 1000,
      cad: { format: "cadcraft", version: 1, drawingId: "drawing-one", drawingSha256: "a".repeat(64), window: [-500, -900, 1500, 3100] },
      ...(presentation ? { presentation: { name: "展示净底", imageDataUrl: png, imageWidth: 1000, imageHeight: 1000,
        sourceFingerprint: await fingerprintFloorplan(png), matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
        anchors: [{ source: { x: 20, y: 20 }, target: { x: 20, y: 20 } }, { source: { x: 80, y: 20 }, target: { x: 80, y: 20 } }, { source: { x: 20, y: 80 }, target: { x: 20, y: 80 } }],
      } } : {}),
    }, { id: "two", name: "二楼", floorplanName: "other.png", floorplanDataUrl: png, imageWidth: 800, imageHeight: 800 }],
    points: [
      { id: "p1", name: "开关", room: "客厅", iconId: "switch-1", status: "confirmed", x: 25, y: 65, productId: "sku1", note: "保留", placed: true, floorId: "one", display: { markerOffset: { x: 4, y: 2 }, labelOffset: { x: 1, y: 1 } } },
      { id: "p2", name: "待定位", room: "客厅", iconId: "switch-1", status: "pending", x: 0, y: 0, productId: "", note: "", placed: false, floorId: "one" },
      { id: "p3", name: "其他楼层", room: "卧室", iconId: "switch-1", status: "confirmed", x: 0, y: 0, productId: "", note: "", placed: true, floorId: "two" },
    ], scenes: [{ id: "s1", name: "回家", trigger: "开关", description: "开灯", pointIds: ["p1"], status: "confirmed" }],
  };
}

describe("floorplan whitespace policy", () => {
  it("keeps pale boundary lines and interior white rooms, with three percent padding", () => {
    const data = new Uint8Array(100 * 100 * 4).fill(255);
    for (const [x, y] of [[20, 30], [79, 69]]) {
      const index = (y * 100 + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 240;
    }
    // Transparent black must not count as ink.
    data[0] = data[1] = data[2] = data[3] = 0;
    expect(findFloorplanCrop(data, 100, 100)).toEqual({ left: 18, top: 28, width: 64, height: 44 });
    expect(() => findFloorplanCrop(new Uint8Array(400).fill(255), 10, 10)).toThrow(/没有可识别/);
  });

  it("preserves real CAD positions, presentation positions, statuses and references as one edit", async () => {
    const plan = await fixture();
    const before = structuredClone(plan);
    const result = await applyPointMapFloorplanCrop(plan, "one", png, crop, image);
    const oldCad = percentToCad(plan.floors![0].cad!.window, plan.points[0].x, plan.points[0].y);
    const newCad = percentToCad(result.floors![0].cad!.window, result.points[0].x, result.points[0].y);
    expect(newCad).toEqual(oldCad);
    const oldBackground = await resolvePointMapBackground(plan.floors![0]);
    const newBackground = await resolvePointMapBackground(result.floors![0]);
    expect(newBackground.transformPoint(result.points[0])).toEqual(oldBackground.transformPoint(plan.points[0]));
    expect(result.points[0]).toMatchObject({ productId: "sku1", status: "confirmed", display: plan.points[0].display });
    expect(result.scenes).toEqual(plan.scenes);
    expect(result.floors![1]).toBe(plan.floors![1]);
    expect(result.points.slice(1)).toEqual(plan.points.slice(1));
    expect(plan).toEqual(before);
  });

  it("rescales engineering-only display offsets without moving installation positions", async () => {
    const plan = await fixture(false);
    const result = await applyPointMapFloorplanCrop(plan, "one", png, crop, image);
    expect(result.points[0].display!.markerOffset).toEqual({ x: 5, y: 2.5 });
    expect(result.points[0]).toMatchObject(cropPercentPosition(plan.points[0], crop, 1000, 1000));
  });

  it("refuses stale images, outside points, invalid bounds and stale calibration without partial edits", async () => {
    const plan = await fixture();
    const before = structuredClone(plan);
    await expect(applyPointMapFloorplanCrop(plan, "one", "old-image", crop, image)).rejects.toThrow(/底图已变化/);
    await expect(applyPointMapFloorplanCrop(plan, "one", png, { ...crop, left: -1 }, image)).rejects.toThrow(/无效/);
    await expect(applyPointMapFloorplanCrop(plan, "one", png, { left: 300, top: 300, width: 400, height: 400 }, image)).rejects.toThrow(/外围存在/);
    plan.floors![0].presentation!.sourceFingerprint = "b".repeat(64);
    await expect(applyPointMapFloorplanCrop(plan, "one", png, crop, image)).rejects.toThrow(/校准已失效/);
    plan.floors![0].presentation!.sourceFingerprint = before.floors![0].presentation!.sourceFingerprint;
    expect(plan).toEqual(before);
  });

  it.each(["edit", "undo", "project", "floor", "source", "read-only"])("does not overwrite %s changes made while the original draft is being backed up", async (change) => {
    const before = await fixture(false);
    const next = await applyPointMapFloorplanCrop(before, "one", png, crop, image);
    let context = { plan: before, projectId: before.projectId, editingDisabled: false };
    let releaseBackup!: (stored: boolean) => void;
    const pendingBackup = new Promise<boolean>((resolve) => { releaseBackup = resolve; });
    const apply = vi.fn();
    const operation = commitPointMapFloorplanCrop({ before, next, floorId: "one", source: png, current: () => context, backup: () => pendingBackup, apply });
    if (change === "edit") context = { ...context, plan: { ...before, points: before.points.map((point) => ({ ...point, name: "等待期间的新编辑" })) } };
    if (change === "undo") context = { ...context, plan: { ...before, points: [] } };
    if (change === "project") context = { ...context, projectId: "other-project" };
    if (change === "floor") context.plan.activeFloorId = "two";
    if (change === "source") context.plan.floors![0].floorplanDataUrl = "replacement-image";
    if (change === "read-only") context = { ...context, editingDisabled: true };
    releaseBackup(true);
    await expect(operation).rejects.toThrow(/已变化/);
    expect(apply).not.toHaveBeenCalled();
    if (change === "edit") expect(context.plan.points[0].name).toBe("等待期间的新编辑");
    if (change === "undo") expect(context.plan.points).toEqual([]);
  });

  it.each([true, false])("applies unchanged drafts once even when persistent backup success is %s", async (stored) => {
    const before = await fixture(false);
    const next = await applyPointMapFloorplanCrop(before, "one", png, crop, image);
    const apply = vi.fn();
    await expect(commitPointMapFloorplanCrop({ before, next, floorId: "one", source: png,
      current: () => ({ plan: before, projectId: before.projectId, editingDisabled: false }),
      backup: async () => stored, apply,
    })).resolves.toBe(stored);
    expect(apply).toHaveBeenCalledExactlyOnceWith(next);
  });
});
