import { describe, expect, it } from "vitest"
import { createCurtainMaterialTemplate, expandPointMaterials, normalizePointMaterials, type PointMaterial } from "../lib/point-materials"
import type { PointSelectionSnapshot, SelectionProduct } from "../lib/product-selection"

const track: SelectionProduct = {
  id: "track-sku", name: "合成电动轨道", sku: "TRACK", deviceTypeId: "curtain-track", unit: "米", status: "active", catalogKind: "sku",
  specs: { track_type: "straight", motor_compatibility: "TEST-MOTOR" }, selectionStatus: "verified", selectionEvidence: "合成轨道资料", pricingStatus: "verified", pricingEvidence: "合成渠道米价", mappingRevision: 1,
}
const motor: SelectionProduct = { ...track, id: "motor", name: "合成电机", sku: "MOTOR", deviceTypeId: "curtain-motor", unit: "台", specs: { power: "ac-mains", track_type: "straight" } }
const kit: SelectionProduct = { ...track, id: "kit", name: "合成套装", sku: "KIT", deviceTypeId: "curtain-kit", unit: "套", specs: { power: "ac-mains", track_type: "straight", motor_count: 1, track_included: true, kit_scope: "电机及轨道" } }
const snapshot = (product: SelectionProduct): PointSelectionSnapshot => ({ productId: product.id, mappingRevision: product.mappingRevision ?? 1, deviceTypeId: product.deviceTypeId!, sku: product.sku!, name: product.name, manufacturerModel: null, specs: { ...product.specs }, protocols: [...(product.protocols ?? [])], capabilities: [...(product.capabilities ?? [])], unit: product.unit, verifiedAt: "2026-10-14T00:00:00Z" })
const material = (patch: Partial<PointMaterial> = {}): PointMaterial => ({ id: "line-track", productId: track.id, role: "track", quantity: 3.6, unit: "米", required: true, included: false, selection: snapshot(track), ...patch })
const point = (materials = [material()]) => ({ id: "point-one", productId: motor.id, deviceTypeId: "curtain-motor", materials })

describe("point materials", () => {
  it("preserves fractional metres and expands deterministically without accumulation", () => {
    const first = expandPointMaterials(point(), [track, motor])
    expect(first.diagnostics).toEqual([])
    expect(first.lineItems).toHaveLength(1)
    expect(first.lineItems[0].quantity).toBe(3.6)
    expect(expandPointMaterials(point(), [track, motor])).toEqual(first)
  })

  it("deduplicates repeated material identities, while retaining the same SKU at another installation", () => {
    const one = expandPointMaterials(point([material(), material()]), [track, motor])
    const two = expandPointMaterials({ ...point(), id: "point-two" }, [track, motor])
    expect(one.lineItems).toHaveLength(1)
    expect(two.lineItems).toHaveLength(1)
    expect(one.lineItems[0].pointId).not.toBe(two.lineItems[0].pointId)
    expect(one.lineItems[0].productId).toBe(two.lineItems[0].productId)
  })

  it("refuses conflicting repeated identities instead of silently dropping quantities", () => {
    expect(() => normalizePointMaterials([material(), material({ quantity: 4.2 })])).toThrow("冲突")
    const result = expandPointMaterials(point([material(), material({ quantity: 4.2 })]), [track, motor])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ code: "invalid-materials", blocking: true })
  })

  it("keeps measured length unknown in a template and blocks required omissions", () => {
    const template = createCurtainMaterialTemplate("installation")
    expect(template[0]).toMatchObject({ quantity: null, productId: "", unit: "米" })
    const result = expandPointMaterials(point(template), [track, motor])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "quantity-unknown", blocking: true }), expect.objectContaining({ code: "product-unknown", blocking: true })]))
  })

  it("does not bill components included in a verified kit or require a separately saleable included SKU", () => {
    const result = expandPointMaterials({ ...point([material({ included: true, productId: "" })]), productId: kit.id, deviceTypeId: "curtain-kit" }, [kit])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it("still requires installation length when a kit includes the track", () => {
    const result = expandPointMaterials({ ...point([material({ included: true, productId: "", quantity: null })]), productId: kit.id, deviceTypeId: "curtain-kit" }, [kit])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "quantity-unknown", blocking: true }))
  })

  it("blocks billing an already included track and a false included claim", () => {
    const doubleCount = expandPointMaterials({ ...point(), productId: kit.id, deviceTypeId: "curtain-kit" }, [kit, track])
    expect(doubleCount.lineItems).toEqual([])
    expect(doubleCount.diagnostics).toContainEqual(expect.objectContaining({ code: "included-double-count", blocking: true }))
    const falseClaim = expandPointMaterials(point([material({ included: true })]), [motor, track])
    expect(falseClaim.diagnostics).toContainEqual(expect.objectContaining({ code: "included-conflict", blocking: true }))
  })

  it("blocks unknown catalogue products, unreviewed prices and unit conversion guesses", () => {
    expect(expandPointMaterials(point(), [motor]).diagnostics).toContainEqual(expect.objectContaining({ code: "product-unknown", blocking: true }))
    expect(expandPointMaterials(point(), [motor, { ...track, pricingStatus: "pending" }]).diagnostics).toContainEqual(expect.objectContaining({ code: "pricing-unverified", blocking: true }))
    expect(expandPointMaterials(point([material({ unit: "套" })]), [motor, track]).diagnostics).toContainEqual(expect.objectContaining({ code: "unit-conflict", blocking: true }))
  })

  it("checks main motor and track type without inferring compatibility from a name", () => {
    const result = expandPointMaterials(point(), [motor, { ...track, specs: { ...track.specs, track_type: "curved" } }])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "track-compatibility-conflict", blocking: true }))
  })

  it("retains optional unselected material as a warning rather than a purchase", () => {
    const result = expandPointMaterials(point([material({ productId: "", quantity: null, required: false })]), [motor])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics.every((issue) => !issue.blocking)).toBe(true)
  })

  it("preserves a historical material snapshot through normalization and rejects forged shape", () => {
    expect(normalizePointMaterials([material()])[0].selection).toEqual(snapshot(track))
    expect(() => normalizePointMaterials([material({ selection: { ...snapshot(track), mappingRevision: "1" } as never })])).toThrow("版本")
  })

  it("requires a server-saved material selection and explicit reselection after product changes", () => {
    expect(expandPointMaterials(point([material({ selection: undefined })]), [motor, track]).diagnostics).toContainEqual(expect.objectContaining({ code: "selection-unsaved", blocking: true }))
    expect(expandPointMaterials(point(), [motor, { ...track, mappingRevision: 2 }]).diagnostics).toContainEqual(expect.objectContaining({ code: "selection-stale", blocking: true }))
  })

  it("deduplicates explicitly identical physical devices while leaving independent material rows intact", () => {
    const sameEntity = point([material({ physicalDeviceId: "device-1" }), material({ id: "other-role", role: "accessory", physicalDeviceId: "device-1" })])
    expect(expandPointMaterials(sameEntity, [track, motor]).lineItems).toHaveLength(1)
    const independent = point([material(), material({ id: "second-track" })])
    expect(expandPointMaterials(independent, [track, motor]).lineItems).toHaveLength(2)
  })

  it("blocks conflicting measurements on the same explicit physical device", () => {
    const result = expandPointMaterials(point([material({ physicalDeviceId: "device-1" }), material({ id: "other", quantity: 4.2, physicalDeviceId: "device-1" })]), [track, motor])
    expect(result.lineItems).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "physical-device-conflict", blocking: true }))
  })

  it("does not claim a motor-only quote is a completed curtain installation", () => {
    expect(expandPointMaterials(point([]), [motor]).diagnostics).toContainEqual(expect.objectContaining({ code: "curtain-materials-incomplete", blocking: true }))
  })

  it.each([0, -1, Infinity, NaN])("rejects invalid quantity %s", (quantity) => {
    expect(() => normalizePointMaterials([material({ quantity })])).toThrow("数量")
  })
})
