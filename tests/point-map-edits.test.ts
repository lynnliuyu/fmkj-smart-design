import { describe, expect, it } from "vitest";
import {
  applyReviewedPointEdit,
  applyReviewedSceneEdit,
  applyUploadedPointMapFloor,
  fillLoadedPointMapFloorDimensions,
  pointMapSceneConfirmationError,
  pointNameAfterIconChange,
  samePointMapDesignContent,
  samePointMapQuoteSource,
} from "../components/projects/point-map-edits";
import type {
  PointMapNode,
  PointMapPlan,
  PointMapScene,
} from "../lib/point-map-plan";

const oldImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const newImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPWsAAAAASUVORK5CYII=";

function point(id: string, floorId: string): PointMapNode {
  return {
    id,
    floorId,
    code: id,
    name: "开关",
    room: "客厅",
    iconId: "switch-1",
    x: 20,
    y: 60,
    placed: true,
    status: "confirmed",
    productId: "product-a",
    note: "保留安装说明",
    controlTargets: ["客厅筒灯"],
    reviewReason: "原有复核说明",
  };
}
function scene(id: string, pointIds: string[]): PointMapScene {
  return {
    id,
    name: "回家",
    trigger: "玄关面板",
    description: "开启照明",
    pointIds,
    status: "confirmed",
  };
}
function plan(): PointMapPlan {
  return {
    projectId: "project-a",
    schemaVersion: 2,
    updatedAt: "2026-10-14T00:00:00.000Z",
    floorplanName: "ground.png",
    floorplanDataUrl: oldImage,
    activeFloorId: "ground",
    floors: [
      {
        id: "ground",
        name: "一楼",
        floorplanName: "ground.png",
        floorplanDataUrl: oldImage,
        imageWidth: 1000,
        imageHeight: 600,
      },
      {
        id: "basement",
        name: "负一楼",
        floorplanName: "basement.png",
        floorplanDataUrl: oldImage,
        imageWidth: 600,
        imageHeight: 1000,
      },
    ],
    points: [
      point("P1", "ground"),
      { ...point("P2", "ground"), placed: false, status: "pending" },
      point("P3", "basement"),
      { ...point("P4", "ground"), status: "planned" },
    ],
    scenes: [
      scene("cross-floor", ["P1", "P3"]),
      scene("basement-only", ["P3"]),
      scene("pending-only", ["P2"]),
    ],
  };
}

describe("review semantics of point-map edits", () => {
  it("keeps quote provenance unchanged when customer circles and labels move", () => {
    const before = plan();
    const after = structuredClone(before);
    after.points[0].display = { markerOffset: { x: 3, y: -1 }, labelOffset: { x: 0, y: 2 } };
    expect(samePointMapQuoteSource(after, before)).toBe(true);
    expect(samePointMapDesignContent(after, before)).toBe(false);
    expect(after.points[0]).toMatchObject({ x: 20, y: 60, status: "confirmed" });
  });
  it("does not regenerate the quote when only a clean display background is attached", () => {
    const before = plan();
    const after = structuredClone(before);
    after.floors![0].presentation = {
      name: "彩平净底", imageDataUrl: newImage, imageWidth: 1000, imageHeight: 600,
      sourceFingerprint: "a".repeat(64), matrix: [1, 0, 0, 1, 0, 0],
      anchors: [
        { source: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
        { source: { x: 100, y: 0 }, target: { x: 100, y: 0 } },
        { source: { x: 0, y: 100 }, target: { x: 0, y: 100 } },
      ],
    };
    expect(samePointMapQuoteSource(after, before)).toBe(true);
    after.points[0].productId = "replacement";
    expect(samePointMapQuoteSource(after, before)).toBe(false);
  });
  it.each(["switch-2", "switch-3", "switch-4", "panel-small"])(
    "replaces a switch with %s while preserving its identity and design information",
    (iconId) => {
      const original = plan();
      const next = applyReviewedPointEdit(original, "P1", { iconId });
      expect(next.points[0]).toEqual({
        ...original.points[0],
        iconId,
        deviceTypeId: iconId === "panel-small" ? "touch-control-panel" : "wall-switch",
        requirements: iconId === "panel-small" ? { screen_size_in: 4 } : { button_count: Number(iconId.slice(-1)) },
        selection: undefined,
        productId: "",
        status: "changed",
      });
      expect(next.scenes![0]).toEqual({
        ...original.scenes![0],
        status: "proposed",
      });
      expect(next.points.slice(1)).toEqual(original.points.slice(1));
      expect(original.points[0].iconId).toBe("switch-1");
    },
  );

  it("does not clear the product or mark a draft dirty when selecting the current icon", () => {
    const original = plan();
    expect(applyReviewedPointEdit(original, "P1", { iconId: "switch-1" })).toBe(
      original,
    );
    expect(original.points[0].productId).toBe("product-a");
  });

  it("renames only a generated point name when its icon type changes", () => {
    const original = plan();
    original.points[0].name = "客厅单开智能开关12";
    const next = applyReviewedPointEdit(original, "P1", { iconId: "switch-3" });
    expect(next.points[0].name).toBe("客厅三开智能开关12");
    expect(next.points[0].productId).toBe("");
    expect(
      pointNameAfterIconChange({ ...original.points[0], name: "客厅入口主控" }, "panel-small"),
    ).toBe("客厅入口主控");
    expect(
      pointNameAfterIconChange({ ...original.points[0], name: "客厅单开智能开关备用" }, "switch-4"),
    ).toBe("客厅单开智能开关备用");
  });

  it.each([
    { controlTargets: ["客厅灯带"] },
    { productId: "product-b" },
    { room: "餐厅" },
    { x: 21 },
    { name: "新版开关" },
  ])(
    "reopens a confirmed point and its linked scenes after changing %j",
    (patch) => {
      const original = plan();
      const next = applyReviewedPointEdit(original, "P1", patch);
      expect(next.points[0].status).toBe("changed");
      expect(next.scenes![0].status).toBe("proposed");
      expect(next.points[2].status).toBe("confirmed");
      expect(next.scenes![1].status).toBe("confirmed");
      expect(original.points[0].status).toBe("confirmed");
    },
  );

  it("keeps no-op edits intact and requires separate explicit scene confirmation", () => {
    const original = plan();
    expect(
      applyReviewedPointEdit(original, "P1", { productId: "product-a" }),
    ).toBe(original);
    original.points[0].status = "planned";
    original.scenes![0].status = "proposed";
    const next = applyReviewedPointEdit(original, "P1", {
      status: "confirmed",
    });
    expect(next.points[0].status).toBe("confirmed");
    expect(next.scenes![0].status).toBe("proposed");
  });

  it.each([
    { trigger: "23:00" },
    { description: "关闭照明" },
    { pointIds: ["P3"] },
    { name: "睡眠" },
  ])("reopens an edited scene for %j", (patch) => {
    const original = plan().scenes!;
    const edited = applyReviewedSceneEdit(original, "cross-floor", patch);
    expect(edited[0].status).toBe("proposed");
    expect(edited[1].status).toBe("confirmed");
    expect(original[0].status).toBe("confirmed");
    expect(
      applyReviewedSceneEdit(edited, "cross-floor", { status: "confirmed" })[0]
        .status,
    ).toBe("confirmed");
  });

  it.each([
    { name: " " },
    { trigger: "\n" },
    { description: "" },
    { pointIds: [] },
    { pointIds: ["missing"] },
  ])("rejects incomplete scene confirmation %j", (patch) => {
    const original = plan();
    expect(
      pointMapSceneConfirmationError(
        { ...original.scenes![0], ...patch },
        original.points,
      ),
    ).toBeTruthy();
    expect(
      pointMapSceneConfirmationError(original.scenes![0], original.points),
    ).toBeNull();
  });
});

describe("floorplan replacement and initial binding", () => {
  it("keeps positions but reopens only placed points and affected scenes on the replaced floor", () => {
    const original = plan();
    const before = JSON.stringify(original);
    const result = applyUploadedPointMapFloor(original, "ground", {
      dataUrl: newImage,
      name: "revised.png",
      width: 1200,
      height: 700,
    });
    expect(result).toMatchObject({ replaced: true, affectedPoints: 2 });
    expect(result.plan.points[0]).toMatchObject({
      status: "changed",
      x: 20,
      y: 60,
      productId: "product-a",
      note: "保留安装说明",
    });
    expect(result.plan.points[0].reviewReason).toContain("底图已替换");
    expect(result.plan.points[0].reviewReason).toContain("原有复核说明");
    expect(result.plan.points[1]).toMatchObject({
      status: "pending",
      placed: false,
    });
    expect(result.plan.points[2].status).toBe("confirmed");
    expect(result.plan.points[3].status).toBe("changed");
    expect(result.plan.scenes!.map((item) => item.status)).toEqual([
      "proposed",
      "confirmed",
      "confirmed",
    ]);
    expect(result.plan.floorplanDataUrl).toBe(newImage);
    expect(result.plan.floors![1]).toEqual(original.floors![1]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("does not reopen reviewed points when the same image is uploaded again", () => {
    const result = applyUploadedPointMapFloor(plan(), "ground", {
      dataUrl: oldImage,
      name: "renamed.png",
      width: 1000,
      height: 600,
    });
    expect(result).toMatchObject({ replaced: false, affectedPoints: 0 });
    expect(result.plan.points[0].status).toBe("confirmed");
    expect(result.plan.scenes![0].status).toBe("confirmed");
  });

  it("accepts proportional resizing for an initially empty draft image", () => {
    const original = plan();
    original.floors![0].floorplanDataUrl = "";
    original.floorplanDataUrl = "";
    const result = applyUploadedPointMapFloor(original, "ground", {
      dataUrl: newImage,
      name: "full-copy.png",
      width: 2000,
      height: 1200,
    });
    expect(result.replaced).toBe(false);
    expect(result.plan.points[0]).toMatchObject({
      x: 20,
      y: 60,
      status: "confirmed",
    });
    expect(result.plan.floors![0]).toMatchObject({
      imageWidth: 2000,
      imageHeight: 1200,
    });
  });

  it("rejects an initial image with a different aspect ratio without changing the draft", () => {
    const original = plan();
    original.floors![0].floorplanDataUrl = "";
    original.floorplanDataUrl = "";
    const before = JSON.stringify(original);
    expect(() =>
      applyUploadedPointMapFloor(original, "ground", {
        dataUrl: newImage,
        name: "cropped.png",
        width: 1000,
        height: 1000,
      }),
    ).toThrow("比例");
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("legacy image measurement", () => {
  function legacyPlan() {
    const original = plan();
    original.floors![0].imageWidth = 0;
    original.floors![0].imageHeight = 0;
    return original;
  }

  it("fills missing dimensions without changing point positions, review statuses or scenes", () => {
    const original = legacyPlan();
    const before = JSON.stringify(original);
    const measured = fillLoadedPointMapFloorDimensions(
      original,
      "ground",
      oldImage,
      { width: 800, height: 400 },
    );
    expect(measured.floors![0]).toMatchObject({
      imageWidth: 800,
      imageHeight: 400,
      floorplanDataUrl: oldImage,
    });
    expect(measured.points).toBe(original.points);
    expect(measured.scenes).toBe(original.scenes);
    expect(measured.points[0]).toMatchObject({
      status: "confirmed",
      x: 20,
      y: 60,
      reviewReason: "原有复核说明",
    });
    expect(measured.scenes![0].status).toBe("confirmed");
    expect(measured.floors![1]).toBe(original.floors![1]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("ignores a stale load after replacing the image or switching floors", () => {
    const replacement = legacyPlan();
    replacement.floors![0].floorplanDataUrl = newImage;
    expect(
      fillLoadedPointMapFloorDimensions(replacement, "ground", oldImage, {
        width: 800,
        height: 400,
      }),
    ).toBe(replacement);
    const switched = legacyPlan();
    switched.activeFloorId = "basement";
    expect(
      fillLoadedPointMapFloorDimensions(switched, "ground", oldImage, {
        width: 800,
        height: 400,
      }),
    ).toBe(switched);
  });

  it("does not replace dimensions that were already recorded", () => {
    const original = plan();
    expect(
      fillLoadedPointMapFloorDimensions(original, "ground", oldImage, {
        width: 800,
        height: 400,
      }),
    ).toBe(original);
  });

  it.each([
    { width: 0, height: 400 },
    { width: NaN, height: 400 },
    { width: 800, height: -1 },
    { width: 800.5, height: 400 },
  ])("ignores unreadable image measurements %j", (size) => {
    const original = legacyPlan();
    expect(
      fillLoadedPointMapFloorDimensions(original, "ground", oldImage, size),
    ).toBe(original);
  });

  it("recognizes only missing measurements of an identical image as a compatible cloud migration", () => {
    const cloud = legacyPlan();
    const local = fillLoadedPointMapFloorDimensions(cloud, "ground", oldImage, {
      width: 800,
      height: 400,
    });
    const beforeLocal = JSON.stringify(local);
    const beforeCloud = JSON.stringify(cloud);
    expect(samePointMapDesignContent(local, cloud)).toBe(true);
    expect(samePointMapDesignContent(cloud, local)).toBe(true);
    expect(JSON.stringify(local)).toBe(beforeLocal);
    expect(JSON.stringify(cloud)).toBe(beforeCloud);
    const changedPoint = {
      ...cloud,
      points: cloud.points.map((point) =>
        point.id === "P1" ? { ...point, x: 21 } : point,
      ),
    };
    expect(samePointMapDesignContent(local, changedPoint)).toBe(false);
    const changedImage = {
      ...cloud,
      floors: cloud.floors!.map((floor) =>
        floor.id === "ground"
          ? { ...floor, floorplanDataUrl: newImage }
          : floor,
      ),
    };
    expect(samePointMapDesignContent(local, changedImage)).toBe(false);
    const differentMeasuredSize = fillLoadedPointMapFloorDimensions(
      cloud,
      "ground",
      oldImage,
      { width: 1000, height: 600 },
    );
    expect(samePointMapDesignContent(local, differentMeasuredSize)).toBe(false);
  });
});
