import { describe, expect, it } from "vitest";
import { applyReviewedPointEdit } from "../components/projects/point-map-edits";
import { exportPointMapDraft, importPointMapDraft, normalizeDesignPlan, parsePointMapDraft, validateDesignPlan } from "../lib/point-map-design";
import { addPointToPlan, emptyPointMapPlan, queueProductPoints, readPointMapPlan, type PointMapPlan } from "../lib/point-map-plan";
import type { QuoteDraftProduct } from "../lib/quote-draft";

const snapshot = {
  productId: "sku-three", mappingRevision: 2, deviceTypeId: "wall-switch", sku: "S3",
  name: "已核三键面板", manufacturerModel: "MODEL-S3", specs: { button_count: 3, relay_count: 2, wiring: "neutral" },
  protocols: ["zigbee"], capabilities: ["load-control"], unit: "个", verifiedAt: "2026-10-14T00:00:00.000Z", verifiedBy: "synthetic-reviewer",
};
function plan(): PointMapPlan {
  return normalizeDesignPlan({ ...emptyPointMapPlan("synthetic"), points: [{
    id: "point-original", code: "K001", iconId: "switch-1", room: "客厅", name: "入口面板", note: "保留原资料", placed: true,
    x: 12.123456789, y: 45.987654321, status: "confirmed", productId: "old-product",
  }] });
}
const product: QuoteDraftProduct = {
  id: "sku-three", name: "三键两路面板", sku: "S3", image: "", category: "开关", price: 200, cost: 100,
  unit: "个", spec: "", deviceTypeId: "wall-switch", specs: { button_count: 3, relay_count: 2, wiring: "neutral" }, catalogKind: "sku", selectionStatus: "pending",
};

describe("structured point selection workflow", () => {
  it("upgrades old placeholders without inventing a one-key requirement or changing existing identity", () => {
    const value = plan();
    expect(value.schemaVersion).toBe(3);
    expect(value.points[0]).toMatchObject({ id: "point-original", code: "K001", productId: "old-product", x: 12.123456789, y: 45.987654321, usage: "proposed" });
    expect(value.points[0].deviceTypeId).toBeUndefined();
    expect(value.points[0].requirements).toBeUndefined();
  });
  it("makes an explicitly added icon a requirement while leaving selection open", () => {
    const value = addPointToPlan(plan(), { iconId: "switch-3", room: "餐厅", position: { x: 11.123456, y: 22.654321 } });
    expect(value.point).toMatchObject({ deviceTypeId: "wall-switch", requirements: { button_count: 3 }, usage: "proposed", productId: "", x: 11.123456, y: 22.654321 });
    expect(value.point.requirements?.relay_count).toBeUndefined();
    expect(value.point.selection).toBeUndefined();
  });
  it("keeps structured requirements and snapshots through strict portable draft and same-ID import", () => {
    const value = plan();
    Object.assign(value.points[0], { iconId: "switch-3", deviceTypeId: "wall-switch", requirements: { button_count: 3, relay_count: 2, wiring: "neutral" }, usage: "selected", productId: snapshot.productId, selection: snapshot, materials: [{ id: "rail-one", role: "track", productId: "rail-sku", quantity: 3.6, unit: "米", required: true, included: false }] });
    const exported = exportPointMapDraft(value);
    expect(exported.version).toBe(2);
    const parsed = parsePointMapDraft(JSON.stringify(exported));
    expect(parsed.points[0]).toEqual(value.points[0]);
    const imported = importPointMapDraft(value, parsed);
    expect(imported.plan.points).toEqual(value.points);
    expect(imported.skipped).toBe(1);
    expect(validateDesignPlan(imported.plan).points[0].selection).toEqual(snapshot);
    expect(validateDesignPlan(imported.plan).points[0].materials).toEqual(value.points[0].materials);
  });
  it("reopens design review for a material quantity change without clearing the primary device", () => {
    const value = plan();
    value.points[0].materials = [{ id: "rail-one", role: "track", productId: "rail-sku", quantity: 3.6, unit: "米", required: true, included: false }];
    const next = applyReviewedPointEdit(value, "point-original", { materials: [{ ...value.points[0].materials[0], quantity: 4.1 }] });
    expect(next.points[0]).toMatchObject({ productId: "old-product", status: "changed", x: 12.123456789, materials: [{ quantity: 4.1 }] });
    expect(value.points[0].materials[0].quantity).toBe(3.6);
  });
  it("does not share mutable product or material snapshots with a normalized historical document", () => {
    const value = plan();
    value.points[0].selection = structuredClone(snapshot);
    value.points[0].materials = [{ id: "extra", role: "accessory", productId: snapshot.productId, quantity: 1, unit: "个", required: false, included: false, selection: structuredClone(snapshot) }];
    const copy = normalizeDesignPlan(value);
    copy.points[0].selection!.specs.button_count = 4;
    copy.points[0].materials![0].selection!.protocols.push("wifi");
    expect(value.points[0].selection.specs.button_count).toBe(3);
    expect(value.points[0].materials[0].selection!.protocols).toEqual(["zigbee"]);
  });
  it("clears a prior SKU and snapshot on key requirements changes but preserves position and notes", () => {
    const value = plan();
    Object.assign(value.points[0], { deviceTypeId: "wall-switch", requirements: { button_count: 3 }, productId: snapshot.productId, selection: snapshot });
    const next = applyReviewedPointEdit(value, "point-original", { requirements: { button_count: 4 } });
    expect(next.points[0]).toMatchObject({ x: 12.123456789, y: 45.987654321, note: "保留原资料", productId: "", status: "changed", requirements: { button_count: 4 } });
    expect(next.points[0].selection).toBeUndefined();
    expect(value.points[0].selection).toEqual(snapshot);
  });
  it("does not infer one key when the user only establishes a wall-switch type", () => {
    const value = applyReviewedPointEdit(plan(), "point-original", { deviceTypeId: "wall-switch", requirements: undefined, iconId: "switch-1" });
    expect(value.points[0].deviceTypeId).toBe("wall-switch");
    expect(value.points[0].requirements).toBeUndefined();
  });
  it("preserves SKU on a pure style operation", () => {
    const value = plan();
    Object.assign(value.points[0], { deviceTypeId: "wall-switch", requirements: { button_count: 3 }, productId: snapshot.productId, selection: snapshot });
    const next = applyReviewedPointEdit(value, "point-original", { iconId: "switch-3" }, { iconChange: "style" });
    expect(next.points[0].productId).toBe(snapshot.productId);
    expect(next.points[0].selection).toEqual(snapshot);
  });
  it.each([
    { quantity: 3.6, product },
    { quantity: 3.6, product: { ...product, unit: "米", deviceTypeId: "curtain-track", specs: { track_type: "直轨" } } },
    { quantity: 2, product: { ...product, deviceTypeId: undefined, specs: undefined, name: "APP控制1/2/3/4键开关" } },
  ])("keeps measured, fractional or untyped quote items out of physical-device expansion", (input) => {
    const value = plan();
    const result = queueProductPoints(value, { projectId: value.projectId, room: "客厅", ...input });
    expect(result.points).toEqual([]);
    expect(result.plan).toBe(value);
  });
  it("generates pending positions from structured but unreviewed products without certifying purchase", () => {
    const result = queueProductPoints(plan(), { product, quantity: 2, projectId: "synthetic", room: "客厅" });
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ iconId: "switch-3", deviceTypeId: "wall-switch", requirements: {}, usage: "proposed", productId: product.id, placed: false });
    expect(result.points[0].selection).toBeUndefined();
  });
  it("rejects future versions and unsupported parameters before changing persisted data", () => {
    const value = plan();
    expect(() => validateDesignPlan({ ...value, schemaVersion: 4 })).toThrow("版本");
    expect(() => parsePointMapDraft({ ...exportPointMapDraft(value), version: 3 })).toThrow("版本");
    const raw = JSON.stringify({ ...value, schemaVersion: 4 });
    expect(() => readPointMapPlan("synthetic", { getItem: () => raw, setItem: () => { throw new Error("must stay read only"); } })).toThrow("版本");
    value.points[0].deviceTypeId = "wall-switch";
    value.points[0].requirements = { button_count: "3" };
    expect(() => validateDesignPlan(value)).toThrow("数值");
    value.points[0].requirements = { typo_button_count: 3 };
    expect(() => validateDesignPlan(value)).toThrow("不支持");
  });
});
