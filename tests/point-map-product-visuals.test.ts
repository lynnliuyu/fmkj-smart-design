import { describe, expect, it } from "vitest"
import { buildPointMapProductVisuals, type PointMapVisualQuoteItem } from "../lib/point-map-product-visuals"
import { emptyPointMapPlan, type PointMapPlan } from "../lib/point-map-plan"
import type { ProductVisualAsset } from "../lib/product-visual-assets"

function asset(image: string, overrides: Partial<ProductVisualAsset> = {}): ProductVisualAsset {
  return { image, sourceImage: "/original.png", crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, scale: 1.25, reviewStatus: "series", revision: 1, updatedAt: "2026-10-15T00:00:00.000Z", ...overrides }
}

function design(): PointMapPlan {
  return {
    ...emptyPointMapPlan("project", () => "2026-10-15T00:00:00.000Z"),
    floors: [
      { id: "first", name: "一层", floorplanName: "one.png", floorplanDataUrl: "", imageWidth: 1000, imageHeight: 1000 },
      { id: "second", name: "二层", floorplanName: "two.png", floorplanDataUrl: "", imageWidth: 1000, imageHeight: 1000 },
    ],
    activeFloorId: "first",
    points: [
      { id: "one", code: "K01", floorId: "first", name: "玄关开关", room: "玄关", iconId: "switch-1", x: 20, y: 30, status: "confirmed", placed: true, productId: "old-switch", note: "" },
      { id: "two", code: "K02", floorId: "second", name: "二层开关", room: "卧室", iconId: "switch-1", x: 20, y: 30, status: "confirmed", placed: true, productId: "second-switch", note: "" },
      { id: "unlinked", code: "K03", floorId: "first", name: "待选型", room: "客厅", iconId: "switch-1", x: 60, y: 50, status: "planned", placed: true, productId: "", note: "" },
      { id: "pending", code: "K04", floorId: "first", name: "待定位", room: "客厅", iconId: "switch-1", x: 50, y: 50, status: "pending", placed: false, productId: "pending-switch", note: "" },
    ],
  }
}

describe("point map product visuals", () => {
  it("uses the current quote product before an older saved point selection", () => {
    const plan = design()
    const before = structuredClone(plan)
    const visuals = buildPointMapProductVisuals(plan, "first", [
      { id: "new-switch", pointIds: ["one"], pointMapProjectId: "project", image: "/new.png" },
    ], [{ id: "old-switch", image: "/old.png" }])
    expect([...visuals.productIdByPointId]).toEqual([["one", "new-switch"]])
    expect(visuals.products).toEqual([{ id: "new-switch", image: "/new.png" }])
    expect(plan).toEqual(before)
  })

  it("immediately resolves a replacement made in the current quote", () => {
    const item = { id: "switch-a", pointIds: ["one"], image: "/a.png" }
    expect(buildPointMapProductVisuals(design(), "first", [item], []).products[0].image).toBe("/a.png")
    const replaced = { ...item, id: "switch-b", image: "/b.png" }
    expect(buildPointMapProductVisuals(design(), "first", [replaced], []).products).toEqual([{ id: "switch-b", image: "/b.png" }])
  })

  it("accepts an explicit productId when the quote id belongs to a quote row", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "quote-row", productId: "sku", pointIds: ["one"], image: "/sku.png" },
    ], [])
    expect(visuals.productIdByPointId.get("one")).toBe("sku")
  })

  it("keeps floor mappings and product image reads separate", () => {
    const items: PointMapVisualQuoteItem[] = [
      { id: "first-product", pointIds: ["one"], image: "/first.png" },
      { id: "second-product", pointIds: ["two"], image: "/second.png" },
      { id: "not-placed", pointIds: ["pending"], get image(): string { throw new Error("unplaced image was read") } },
    ]
    const first = buildPointMapProductVisuals(design(), "first", items, [
      { id: "second-product", get image(): string { throw new Error("other floor image was read") } },
      { id: "unused", get image(): string { throw new Error("unused image was read") } },
    ])
    const second = buildPointMapProductVisuals(design(), "second", items.slice(0, 2), [])
    expect(first.products).toEqual([{ id: "first-product", image: "/first.png" }])
    expect(second.products).toEqual([{ id: "second-product", image: "/second.png" }])
    expect([...second.productIdByPointId.keys()]).toEqual(["two"])
  })

  it("ignores a quote mapping explicitly sourced from another project", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "foreign", pointIds: ["one"], pointMapProjectId: "another-project", image: "/foreign.png" },
    ], [{ id: "old-switch", image: "/old.png" }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/old.png" }])
  })

  it("accepts legacy quote mappings with no source project", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "legacy", pointIds: ["one"], image: "/legacy.png" },
    ], [])
    expect(visuals.productIdByPointId.get("one")).toBe("legacy")
  })

  it("uses catalog images for point selections and keeps unlinked points as icons", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [], [
      { id: "old-switch", image: "/old.png" },
      { id: "second-switch", image: "/second.png" },
      { id: "pending-switch", image: "/pending.png" },
    ])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/old.png" }])
    expect(visuals.productIdByPointId.has("unlinked")).toBe(false)
    expect(visuals.productIdByPointId.has("pending")).toBe(false)
  })

  it("prefers the current quote's product image over the catalog image", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image: " /quote-image.png " },
    ], [{ id: "old-switch", image: "/catalog-image.png" }])
    expect(visuals.products[0].image).toBe("/quote-image.png")
  })

  it("uses the quote's frozen crop and scale before a newer catalog derivative even for the same image URL", () => {
    const historical = asset("/shared-photo.png", { crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, scale: 0.9, revision: 2 })
    const latest = asset("/shared-photo.png", { crop: { x: 0, y: 0, width: 1, height: 1 }, scale: 1.8, revision: 5 })
    const plan = design()
    const items = [{ id: "old-switch", pointIds: ["one"], image: historical.image, productSnapshot: { image: historical.image, visualAsset: historical } }]
    const catalog = [{ id: "old-switch", image: "/original.png", visualAsset: latest }]
    const before = structuredClone({ plan, items, catalog })
    const visuals = buildPointMapProductVisuals(plan, "first", items, catalog)
    expect(visuals.products).toEqual([{ id: "old-switch", image: historical.image, visualAsset: historical }])
    expect({ plan, items, catalog }).toEqual(before)
  })

  it("does not apply a new catalog photo's crop to a legacy quote's different photo", () => {
    const latest = asset("/new-clean-photo.png", { scale: 1.9 })
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image: "/old-quote-photo.png", productSnapshot: { image: "/old-quote-photo.png" } },
    ], [{ id: "old-switch", image: latest.image, visualAsset: latest }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/old-quote-photo.png" }])
  })

  it("uses current derivative framing for a legacy quote only when its exact image URL matches", () => {
    const latest = asset("/same-clean-photo.png")
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image: latest.image },
    ], [{ id: "old-switch", image: "/original.png", visualAsset: latest }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: latest.image, visualAsset: latest }])
  })

  it.each([null, "", "/placeholder.svg"])("uses the reusable derivative when the quote has no usable photo (%s)", (image) => {
    const latest = asset("/clean-photo.png")
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image },
    ], [{ id: "old-switch", image: "/original-with-margin.png", visualAsset: latest }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: latest.image, visualAsset: latest }])
  })

  it("does not read derivative metadata belonging to another floor or unused product", () => {
    const current = asset("/first-clean.png")
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image: current.image, productSnapshot: { visualAsset: current } },
      { id: "second-switch", pointIds: ["two"], get productSnapshot(): Record<string, unknown> { throw new Error("other floor quote crop was read") } },
    ], [
      { id: "old-switch", image: "/first-original.png", visualAsset: current },
      { id: "second-switch", get visualAsset(): ProductVisualAsset { throw new Error("other floor crop was read") } },
      { id: "unused", get visualAsset(): ProductVisualAsset { throw new Error("unused crop was read") } },
    ])
    expect(visuals.products).toEqual([{ id: "old-switch", image: current.image, visualAsset: current }])
  })

  it("does not attach a mismatched frozen derivative to a quote's independently retained photo", () => {
    const mismatched = asset("/different-photo.png", { scale: 1.9 })
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image: "/retained-quote-photo.png", productSnapshot: { image: "/retained-quote-photo.png", visualAsset: mismatched } },
    ], [{ id: "old-switch", image: "/catalog.png" }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/retained-quote-photo.png" }])
  })

  it("drops unusable derivative framing when falling back to the original catalog image", () => {
    const unavailable = asset("/placeholder.png")
    const visuals = buildPointMapProductVisuals(design(), "first", [], [
      { id: "old-switch", image: "/catalog-original.png", visualAsset: unavailable },
    ])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/catalog-original.png" }])
  })

  it.each([null, "", "   ", "/placeholder.svg", "/placeholder.svg?height=80", "/placeholder-user.jpg", "https://example.com/placeholder.png", "javascript:alert(1)", "data:text/plain,image", "http://[invalid"])('replaces unusable quote image %s with a real catalog image', (image) => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", pointIds: ["one"], image },
    ], [{ id: "old-switch", image: "/catalog.png" }])
    expect(visuals.products[0].image).toBe("/catalog.png")
  })

  it("keeps the product mapping when neither source has a real image", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [], [{ id: "old-switch", image: "/placeholder.svg" }])
    expect(visuals.products).toEqual([{ id: "old-switch", image: null }])
    expect(visuals.productIdByPointId.get("one")).toBe("old-switch")
  })

  it("deduplicates repeated point references, identical quote rows, and shared products", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "shared", pointIds: ["one", "one", "unlinked"], image: "/placeholder.svg" },
      { id: "shared", pointIds: ["one", "unlinked"], image: "/shared.png" },
    ], [])
    expect([...visuals.productIdByPointId]).toEqual([["one", "shared"], ["unlinked", "shared"]])
    expect(visuals.products).toEqual([{ id: "shared", image: "/shared.png" }])
  })

  it("reports conflicting products on a single placed point instead of silently choosing one", () => {
    expect(() => buildPointMapProductVisuals(design(), "first", [
      { id: "first-product", pointIds: ["one"] },
      { id: "conflicting-product", pointIds: ["one"] },
    ], [])).toThrow("点位 K01 在当前报价中关联了多个商品")
  })

  it("keeps the main device when track and service rows share its installation point", () => {
    const plan = design()
    plan.points[0].materials = [
      { id: "track-material", productId: "track", role: "track", quantity: 3.6, unit: "米", required: true, included: false },
      { id: "service-material", productId: "installation", role: "service", quantity: 1, unit: "项", required: true, included: false },
    ]
    const items: PointMapVisualQuoteItem[] = [
      { id: "track", pointIds: ["one"], get image(): string { throw new Error("material image was read") } },
      { id: "motor", pointIds: ["one"], image: "/motor.png" },
      { id: "installation", pointIds: ["one"], get image(): string { throw new Error("service image was read") } },
    ]
    const visuals = buildPointMapProductVisuals(plan, "first", items, [])
    expect([...visuals.productIdByPointId]).toEqual([["one", "motor"]])
    expect(visuals.products).toEqual([{ id: "motor", image: "/motor.png" }])
    expect(buildPointMapProductVisuals(plan, "first", [...items].reverse(), []).products).toEqual(visuals.products)
  })

  it("skips a material reference only for the point whose materials explicitly contain that product", () => {
    const plan = design()
    plan.points[0].materials = [
      { id: "accessory-material", productId: "shared-product", role: "accessory", quantity: 1, unit: "个", required: true, included: false },
    ]
    const visuals = buildPointMapProductVisuals(plan, "first", [
      { id: "motor", pointIds: ["one"], image: "/motor.png" },
      { id: "shared-product", pointIds: ["one", "unlinked"], image: "/shared-product.png" },
    ], [])
    expect([...visuals.productIdByPointId]).toEqual([["one", "motor"], ["unlinked", "shared-product"]])
    expect(visuals.products).toEqual([{ id: "motor", image: "/motor.png" }, { id: "shared-product", image: "/shared-product.png" }])
  })

  it("falls back to the point's device if its quote only contains explicit materials", () => {
    const plan = design()
    plan.points[0].materials = [
      { id: "track-material", productId: "track", role: "track", quantity: 3.6, unit: "米", required: true, included: false },
    ]
    const visuals = buildPointMapProductVisuals(plan, "first", [{ id: "track", pointIds: ["one"], image: "/track.png" }], [
      { id: "old-switch", image: "/old.png" },
    ])
    expect(visuals.products).toEqual([{ id: "old-switch", image: "/old.png" }])
  })

  it("ignores conflicts on other floors and on points that have not been placed", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "a", pointIds: ["two", "pending"] },
      { id: "b", pointIds: ["two", "pending"] },
    ], [])
    expect(visuals.products).toEqual([{ id: "old-switch", image: null }])
  })

  it("does not use images from quote items with no current-floor point references", () => {
    const visuals = buildPointMapProductVisuals(design(), "first", [
      { id: "old-switch", image: "/unmapped.png", pointIds: ["missing-point"] },
      { id: "", pointIds: ["one"], image: "/missing-id.png" },
    ], [{ id: "old-switch", image: "/catalog.png" }])
    expect(visuals.products[0].image).toBe("/catalog.png")
  })

  it("rejects a missing floor before resolving any images", () => {
    expect(() => buildPointMapProductVisuals(design(), "missing", [], [])).toThrow("未找到需要出图的楼层")
  })
})
