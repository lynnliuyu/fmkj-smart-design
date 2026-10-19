import { describe, expect, it } from "vitest"
import { buildProcurementPreview, type ProcurementProduct } from "../lib/point-map-procurement"
import type { PointMapNode, PointMapPlan } from "../lib/point-map-plan"
import { refreshPointMapQuote } from "../lib/point-map-quote-refresh"
import { quoteVerificationLabel } from "../lib/quote-verification"

const DEFAULT_ID = "6a1f9980-da4c-482d-b260-8701e77655da"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

const defaultSwitch = { id: DEFAULT_ID, name: "苏米智能开关H2（零火版）", sku: "H2-N", category: "开关", deviceTypeId: "wall-switch", catalogKind: "sku", specs: {}, protocols: [], capabilities: [], selectionStatus: "pending", pricingStatus: "pending", mappingRevision: 1, status: "active", unit: "个", price: 159, cost: 100, spec: "H2", image: "/placeholder.svg" } as unknown as ProcurementProduct
const defaults = new Map([["wall-switch", defaultSwitch]])

const point = (overrides: Partial<PointMapNode>): PointMapNode => ({
  id: "p1", name: "客厅开关", room: "客厅", code: "K01", floorId: "f1", iconId: "switch-3", status: "pending",
  x: 10, y: 10, placed: false, productId: "", note: "", deviceTypeId: "wall-switch", usage: "proposed", ...overrides,
} as PointMapNode)

const plan = (points: PointMapNode[]): PointMapPlan => ({
  projectId: "p", schemaVersion: 3, floorplanName: "", floorplanDataUrl: "",
  floors: [{ id: "f1", name: "一层", floorplanName: "", floorplanDataUrl: "", imageWidth: 0, imageHeight: 0 }],
  points, updatedAt: "2026-10-14T00:00:00.000Z",
} as PointMapPlan)

describe("procurement preview with category defaults", () => {
  it("synchronizes default curtain motors as unverified quotes without inventing track quantities", async () => {
    const motor = { ...defaultSwitch, id: OTHER_ID, name: "默认窗帘电机", sku: "CURTAIN", deviceTypeId: "curtain-motor", category: "窗帘", unit: "台" };
    const current = plan([point({ id: "switch" }), ...Array.from({ length: 4 }, (_, i) => point({ id: `curtain-${i}`, code: `C0${i + 1}`, iconId: "curtain", deviceTypeId: "curtain-motor", materials: [] }))]);
    const before = structuredClone(current);
    const preview = buildProcurementPreview(current, 4, [], "p", new Map([...defaults, ["curtain-motor", motor]]));
    let published: unknown;
    const result = await refreshPointMapQuote("p", "项目", { expectedRevision: 4,
      fetcher: async () => new Response(JSON.stringify(preview)), publish: (snapshot) => { published = snapshot; },
    });
    expect(result).toMatchObject({ updated: true, included: 5, unverified: 5 });
    expect(published).toBeDefined();
    expect(preview).toMatchObject({ blocked: false, procurementReady: false });
    expect(preview.data.items).toHaveLength(2);
    expect(preview.data.items.find((item) => item.id === OTHER_ID)).toMatchObject({ quantity: 4, productSnapshot: { quotationVerification: { status: "unverified", reasons: expect.arrayContaining([expect.stringContaining("未计入本次报价")]) } } });
    expect(quoteVerificationLabel(preview.data.items.find((item) => item.id === OTHER_ID)!)).toContain("配套未计入本次报价");
    expect(current).toEqual(before);
  });

  it("allows unknown track lengths in default quotations but still blocks conflicting material data and formal procurement", () => {
    const motor = { ...defaultSwitch, id: OTHER_ID, deviceTypeId: "curtain-motor", category: "窗帘", unit: "台" };
    const material = { id: "track", role: "track" as const, quantity: null, unit: "米", productId: "", required: true, included: false };
    const curtain = point({ iconId: "curtain", deviceTypeId: "curtain-motor", materials: [material] });
    const categoryDefaults = new Map([["curtain-motor", motor]]);
    expect(buildProcurementPreview(plan([curtain]), 4, [], "p", categoryDefaults)).toMatchObject({ blocked: false, included: 1, procurementReady: false });
    const stale = { ...curtain, materials: [{ ...material, productId: "missing-sku" }] };
    expect(buildProcurementPreview(plan([stale]), 4, [], "p", categoryDefaults).blocked).toBe(true);
    const included = { ...curtain, materials: [{ ...material, included: true }] };
    expect(buildProcurementPreview(plan([included]), 4, [], "p", categoryDefaults).blocked).toBe(true);
    expect(buildProcurementPreview(plan([{ ...curtain, usage: "selected", productId: OTHER_ID, placed: true, status: "confirmed" }]), 4, [motor], "p").blocked).toBe(true);
  });
  it("counts an unassigned switch as its category default without selection or placement", () => {
    const preview = buildProcurementPreview(plan([point({})]), 1, [], "p", defaults)
    expect(preview.blocked).toBe(false)
    expect(preview.included).toBe(1)
    expect(preview.data.items[0]).toMatchObject({ id: DEFAULT_ID, quantity: 1, room: "一层 / 客厅" })
    expect(preview.procurementReady).toBe(false)
    expect(preview.unverified[0].pointId).toBe("p1")
    expect(preview.data.items[0].productSnapshot).toMatchObject({ quotationVerification: { status: "unverified", source: "default" } })
  })

  it("groups several unassigned switches in the same room into one line", () => {
    const preview = buildProcurementPreview(plan([point({ id: "a" }), point({ id: "b", code: "K02" })]), 1, [], "p", defaults)
    expect(preview.data.items).toHaveLength(1)
    expect(preview.data.items[0].quantity).toBe(2)
  })

  it("does not apply the category default to a point with its own product", () => {
    const preview = buildProcurementPreview(plan([point({ productId: OTHER_ID, usage: "selected" })]), 1, [], "p", defaults)
    expect(preview.data.items.map((item) => item.id)).not.toContain(DEFAULT_ID)
    expect(preview.included).toBe(0)
    expect(preview.blocked).toBe(true)
  })

  it("still excludes reserve points even when their category has a default", () => {
    const preview = buildProcurementPreview(plan([point({ usage: "reserve" })]), 1, [], "p", defaults)
    expect(preview.included).toBe(0)
    expect(preview.excluded).toBe(1)
    expect(preview.data.items).toHaveLength(0)
  })

  it("leaves unassigned points excluded when the category has no product in the library", () => {
    const preview = buildProcurementPreview(plan([point({})]), 1, [], "p", new Map())
    expect(preview.blocked).toBe(false)
    expect(preview.excluded).toBe(1)
  })

  it("blocks a selected point with no product and no category default", () => {
    const preview = buildProcurementPreview(plan([point({ usage: "selected" })]), 1, [], "p", new Map())
    expect(preview.blocked).toBe(true)
    expect(preview.diagnostics[0].reasons).toContain("尚未选择具体产品")
  })

  it("excludes points whose device type cannot be inferred from the icon", () => {
    const preview = buildProcurementPreview(plan([point({ deviceTypeId: undefined, iconId: "unknown-icon" })]), 1, [], "p", defaults)
    expect(preview.included).toBe(0)
    expect(preview.excluded).toBe(1)
  })

  it("infers the device type from the icon when a point has none", () => {
    const preview = buildProcurementPreview(plan([point({ deviceTypeId: undefined, iconId: "switch-1" })]), 1, [], "p", defaults)
    expect(preview.included).toBe(1)
    expect(preview.data.items[0].id).toBe(DEFAULT_ID)
  })
})
