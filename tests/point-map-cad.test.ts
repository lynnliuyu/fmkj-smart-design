import { describe, expect, it } from "vitest";
import {
  applyCadReturn,
  createCadExchange,
  previewCadReturn,
} from "../lib/point-map-cad";
import {
  cadToPercent,
  parseCadExchange,
  parseCadReturn,
  percentToCad,
  type CadExchange,
} from "../lib/point-map-cad-contract";
import {
  exportPointMapDraft,
  importPointMapDraft,
  validateDesignPlan,
} from "../lib/point-map-design";
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan";
import { applyUploadedPointMapFloor } from "../components/projects/point-map-edits";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function plan(): PointMapPlan {
  return {
    projectId: "project-one",
    schemaVersion: 2,
    updatedAt: "2026-10-14T00:00:00.000Z",
    floorplanName: "base.png",
    floorplanDataUrl: image,
    activeFloorId: "floor-one",
    floors: [
      {
        id: "floor-one",
        name: "一楼",
        floorplanName: "base.png",
        floorplanDataUrl: image,
        imageWidth: 2000,
        imageHeight: 1000,
        cad: {
          format: "cadcraft",
          version: 1,
          drawingId: "drawing-one",
          drawingSha256: "a".repeat(64),
          window: [1000, 2000, 3000, 3000],
        },
      },
    ],
    points: [
      {
        id: "point-one",
        floorId: "floor-one",
        code: "K01",
        name: "开关",
        room: "客厅",
        iconId: "switch-1",
        x: 25,
        y: 60,
        status: "confirmed",
        placed: true,
        productId: "chosen-product",
        note: "安装说明",
        controlTargets: ["客厅筒灯"],
      },
      {
        id: "point-two",
        floorId: "floor-one",
        code: "K02",
        name: "场景",
        room: "玄关",
        iconId: "switch-4",
        x: 30,
        y: 40,
        status: "confirmed",
        placed: true,
        productId: "",
        note: "",
      },
    ],
    scenes: [
      {
        id: "scene-one",
        name: "回家",
        trigger: "按面板",
        description: "开启客厅照明",
        pointIds: ["point-one"],
        status: "confirmed",
      },
      {
        id: "scene-two",
        name: "离家",
        trigger: "按面板",
        description: "关闭照明",
        pointIds: ["point-two"],
        status: "confirmed",
      },
    ],
  };
}
function returned(exchange: CadExchange) {
  return {
    format: "fmkj-cadcraft-return",
    version: 1,
    exchange,
    positions: exchange.points.map((point, index) => ({
      id: point.id,
      ...percentToCad(
        exchange.drawing.window,
        point.x + (index ? 0 : 2),
        point.y - (index ? 0 : 3),
      ),
    })),
  };
}

describe("CAD drawing exchange", () => {
  it("converts CAD Y-up and image Y-down independently of zoom or image resolution", () => {
    const window: [number, number, number, number] = [1000, 2000, 3000, 3000];
    expect(percentToCad(window, 25, 60)).toEqual({ cadX: 1500, cadY: 2400 });
    expect(cadToPercent(window, 1500, 2400)).toEqual({ x: 25, y: 60 });
    expect(cadToPercent(window, 1000, 3000)).toEqual({ x: 0, y: 0 });
    expect(cadToPercent(window, 3000, 2000)).toEqual({ x: 100, y: 100 });
  });

  it("updates coordinates only, retains later business edits and reopens only linked decisions", async () => {
    const original = plan();
    const exchange = await createCadExchange(original, "floor-one");
    const current = structuredClone(original);
    current.points[0].productId = "later-product";
    current.points[0].controlTargets = ["新灯组"];
    current.points[0].deviceTypeId = "wall-switch";
    current.points[0].requirements = { button_count: 3, relay_count: 2, wiring: "neutral" };
    current.points[0].usage = "reserve";
    const result = await applyCadReturn(current, returned(exchange));
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.plan.points[0]).toMatchObject({
      id: "point-one",
      code: "K01",
      x: 27,
      y: 57,
      status: "changed",
      productId: "later-product",
      controlTargets: ["新灯组"],
      note: "安装说明",
      deviceTypeId: "wall-switch",
      requirements: { button_count: 3, relay_count: 2, wiring: "neutral" },
      usage: "reserve",
    });
    expect(result.plan.scenes!.map((scene) => scene.status)).toEqual([
      "proposed",
      "confirmed",
    ]);
    expect(original.points[0]).toMatchObject({
      x: 25,
      y: 60,
      status: "confirmed",
    });
    const repeated = await applyCadReturn(result.plan, returned(exchange));
    expect(repeated.plan).toBe(result.plan);
    expect(repeated.updated).toBe(0);
  });

  it("rejects concurrent coordinate changes atomically, including a changed but unmoved CAD point", async () => {
    const current = plan();
    const payload = returned(await createCadExchange(current, "floor-one"));
    current.points[1].x = 32;
    await expect(previewCadReturn(current, payload)).rejects.toThrow("冲突");
    expect(current.points[0].x).toBe(25);
  });

  it("rejects a deleted, unplaced or transferred point instead of recreating it", async () => {
    const original = plan();
    const payload = returned(await createCadExchange(original, "floor-one"));
    for (const mutate of [
      (p: PointMapPlan) => {
        p.points.splice(0, 1);
        p.scenes = p.scenes!.filter(
          (scene) => !scene.pointIds.includes("point-one"),
        );
      },
      (p: PointMapPlan) => {
        p.points[0].placed = false;
      },
      (p: PointMapPlan) => {
        p.points[0].floorId = "other-floor";
        p.floors!.push({ ...p.floors![0], id: "other-floor" });
      },
    ]) {
      const current = structuredClone(original);
      mutate(current);
      await expect(previewCadReturn(current, payload)).rejects.toThrow(
        "已删除、取消定位或更换楼层",
      );
    }
  });

  it("rejects the wrong project, CAD drawing, window or background", async () => {
    const original = plan();
    const payload = returned(await createCadExchange(original, "floor-one"));
    const wrongProject = { ...original, projectId: "project-two" };
    await expect(previewCadReturn(wrongProject, payload)).rejects.toThrow(
      "不属于",
    );
    for (const mutate of [
      (p: PointMapPlan) => {
        p.floors![0].cad!.drawingSha256 = "b".repeat(64);
      },
      (p: PointMapPlan) => {
        p.floors![0].cad!.drawingId = "different-drawing";
      },
      (p: PointMapPlan) => {
        p.floors![0].cad!.window = [1001, 2000, 3001, 3000];
      },
      (p: PointMapPlan) => {
        p.floors![0].floorplanDataUrl = image.replace("AFgAI", "BFgAI");
      },
    ]) {
      const current = structuredClone(original);
      mutate(current);
      await expect(previewCadReturn(current, payload)).rejects.toThrow(
        /底图|背景/,
      );
    }
  });

  it("rejects copied IDs, missing/unknown blocks, non-finite and outside coordinates", async () => {
    const exchange = await createCadExchange(plan(), "floor-one");
    const payload = returned(exchange);
    for (const positions of [
      [payload.positions[0], payload.positions[0]],
      [payload.positions[0]],
      [payload.positions[0], { ...payload.positions[1], id: "unknown" }],
      [payload.positions[0], { ...payload.positions[1], cadX: Infinity }],
      [payload.positions[0], { ...payload.positions[1], cadX: 3001 }],
    ])
      expect(() => parseCadReturn({ ...payload, positions })).toThrow();
    expect(() => parseCadExchange({ ...exchange, command: "move" })).toThrow(
      "未知字段",
    );
    expect(() => parseCadReturn({ ...payload, version: 2 })).toThrow();
  });

  it("round-trips floor bindings in drafts while preserving ordinary same-ID import behavior", async () => {
    const original = plan();
    const draft = exportPointMapDraft(original);
    const imported = importPointMapDraft(
      emptyPointMapPlan("project-two"),
      draft,
    ).plan;
    expect(imported.floors![0].cad).toEqual(original.floors![0].cad);
    imported.points[0].x = 49;
    expect(importPointMapDraft(imported, draft).plan.points[0].x).toBe(49);
    const binding = imported.floors![0].cad!;
    imported.floors![0].cad = {
      window: binding.window,
      drawingId: binding.drawingId,
      format: binding.format,
      version: binding.version,
      drawingSha256: binding.drawingSha256,
    };
    expect(importPointMapDraft(imported, draft).plan.points[0].x).toBe(49);
    const different = structuredClone(draft);
    different.floors[0].cad!.drawingId = "wrong";
    expect(() => importPointMapDraft(imported, different)).toThrow("不一致");
    const unbound = structuredClone(draft);
    delete unbound.floors[0].cad;
    expect(() => importPointMapDraft(imported, unbound)).toThrow("CAD 绑定");
    const unboundPlan = structuredClone(imported);
    delete unboundPlan.floors![0].cad;
    expect(() => importPointMapDraft(unboundPlan, draft)).toThrow("CAD 绑定");
  });

  it("clears CAD binding after replacing the floor image and rejects invalid aspect bindings", () => {
    const original = plan();
    const replacement = image.replace("AFgAI", "BFgAI");
    const next = applyUploadedPointMapFloor(original, "floor-one", {
      dataUrl: replacement,
      name: "new.png",
      width: 2000,
      height: 1000,
    }).plan;
    expect(next.floors![0].cad).toBeUndefined();
    expect(original.floors![0].cad).toBeDefined();
    expect(
      applyUploadedPointMapFloor(original, "floor-one", {
        dataUrl: image,
        name: "same.png",
        width: 2000,
        height: 1000,
      }).plan.floors![0].cad,
    ).toBeDefined();
    const invalid = plan();
    invalid.floors![0].imageWidth = 1000;
    expect(() => validateDesignPlan(invalid)).toThrow("比例不符");
  });
});
