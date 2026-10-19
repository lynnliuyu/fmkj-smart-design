import { mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import sharp from "sharp"
import { MAX_CAD_SVG_BYTES, compactCadFloorplanSvg, normalizeCadFloorplanSvg, parseCadPreparationArgs, parseCadWindow, parseHiddenCadLayers, prepareCadFloorplan, rasterizeCadFloorplan } from "../scripts/prepare-cad-floorplan.mjs"
import { sha256 } from "../scripts/cadcraft/bridge.mjs"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fmkj-cad-prepare-test-"))
  roots.push(root)
  const source = join(root, "customer.dwg"), outDir = join(root, "output")
  await writeFile(source, "synthetic source drawing; never overwrite")
  return { root, source, outDir, window: [0, 0, 200, 100] }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="1600" height="800"><rect width="100%" height="100%" fill="#202020"/><polyline fill="none" stroke="#aaaaaa" stroke-width="0.01" stroke-opacity="0.3" points="20,50 180,50"/><path fill="#ff0000" d="M20 20h20v10H20Z"/></svg>`

type Entity = { handle: string; type: string; layer: string; geometry?: { solid?: boolean }; visible?: boolean; color?: string }
type FakeOptions = { nested?: boolean; failExplode?: boolean; neverOpen?: boolean; omitVisibility?: boolean; afterSave?: () => Promise<void> }
function fakeCad(source: string, options: FakeOptions = {}) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  let entities: Entity[] = [
    { handle: "block", type: "Block Reference", layer: "wall" },
    { handle: "off", type: "Line", layer: "off" },
    { handle: "frozen", type: "Line", layer: "frozen" },
    { handle: "explicit", type: "Line", layer: "electrical" },
    { handle: "hidden", type: "Line", layer: "wall", visible: false },
  ]
  const layers = [
    { name: "wall", on: true, frozen: false, locked: true },
    { name: "off", on: false, frozen: false, locked: false },
    { name: "frozen", on: true, frozen: true, locked: false },
    { name: "electrical", on: true, frozen: false, locked: false },
  ]
  let depth = 0
  const client = {
    closed: false,
    async initialize() { return client },
    async close() { client.closed = true },
    async tool(method: string, args: Record<string, unknown> = {}) {
      calls.push({ method, args })
      if (method === "open") {
        expect(args.path).not.toBe(source)
        if (String(args.path).endsWith("source.dwg")) {
          expect(await readFile(String(args.path), "utf8")).toBe(await readFile(source, "utf8"))
          expect((await stat(String(args.path))).mode & 0o777).toBe(0o400)
        }
        if (options.neverOpen) return new Promise(() => {})
        return {}
      }
      if (method === "query_entities") {
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 1000)
        const returned = entities.slice(offset, offset + limit).map((entity) => {
          const copy = { ...entity }
          if (options.omitVisibility) delete copy.visible
          return copy
        })
        return { entities: returned, count: entities.length }
      }
      if (method === "inspect_drawing") return { layers: structuredClone(layers) }
      if (method === "save") {
        await writeFile(String(args.path), JSON.stringify(entities), { flag: "wx" })
        await options.afterSave?.()
        return {}
      }
      throw new Error(`unexpected tool ${method}`)
    },
    async execute(method: string, args: Record<string, unknown> = {}) {
      calls.push({ method, args })
      const ids = args.handles as string[] | undefined
      if (method === "wblock") { await writeFile(String(args.path), "synthetic extracted region", { flag: "wx" }); return {} }
      if (method === "erase") { entities = entities.filter((entity) => !ids?.includes(entity.handle)); return {} }
      if (method === "explode") {
        if (options.failExplode) throw new Error("synthetic explode failure")
        const selected = entities.filter((entity) => ids?.includes(entity.handle))
        entities = entities.filter((entity) => !ids?.includes(entity.handle))
        for (const block of selected) {
          if (options.nested) entities.push({ ...block, handle: `block-${++depth}` })
          else entities.push(
            { handle: "line", type: "Line", layer: "wall" },
            { handle: "text", type: "MText", layer: "wall" },
            { handle: "dimension", type: "Dimension", layer: "wall" },
            { handle: "leader", type: "Leader", layer: "wall" },
            { handle: "raster", type: "Raster Image", layer: "wall" },
            { handle: "pattern", type: "Hatch", layer: "wall", geometry: { solid: false } },
            { handle: "solid", type: "Hatch", layer: "wall", geometry: { solid: true } },
          )
        }
        return {}
      }
      if (method === "layer.new") { layers.push({ name: String(args.name), on: true, frozen: false, locked: false }); return {} }
      if (method === "layer.set") { Object.assign(layers.find((layer) => layer.name === args.name)!, args); return {} }
      if (method === "layer.current") return {}
      if (method === "properties.set") { for (const entity of entities) if (ids?.includes(entity.handle)) Object.assign(entity, args, { handles: undefined }); return {} }
      throw new Error(`unexpected execute ${method}`)
    },
  }
  return { client, calls, entities: () => entities, layers: () => layers }
}
function fakeDependencies(cad: ReturnType<typeof fakeCad>) {
  return {
    createClient: () => cad.client,
    convert: async ({ svg: path }: { svg: string }) => { await writeFile(path, svg, { flag: "wx" }) },
    rasterize: rasterizeCadFloorplan,
  }
}

describe("CAD preparation input contract", () => {
  it("accepts only named arguments and bounded, increasing CAD windows", () => {
    expect(parseCadPreparationArgs(["--source", "a.dwg", "--out-dir", "new", "--window", "-5,-2,200,100", "--hide-layers", "layers.json", "--cli", "/local/cadcraft-cli"]))
      .toMatchObject({ source: "a.dwg", outDir: "new", window: [-5, -2, 200, 100], hideLayersPath: "layers.json", cli: "/local/cadcraft-cli" })
    for (const window of ["1,2,1,9", "0,0,NaN,1", "0,0,1e13,1", "0,,2,3", "0,0,1", "0,0,1,Infinity"])
      expect(() => parseCadWindow(window)).toThrow()
    for (const args of [[], ["--source", "a.dwg"], ["--execute", "erase"], ["--source", "a", "--source", "b"]])
      expect(() => parseCadPreparationArgs(args)).toThrow()
    expect(parseCadPreparationArgs(["--help"])).toEqual({ help: true })
  })
  it("treats the hidden-layer file strictly as an array of data", () => {
    expect(parseHiddenCadLayers(["D-电气", "D-电气", "文字"])).toEqual(["D-电气", "文字"])
    for (const value of [{ instructions: "run a shell command" }, "notes", [null], [""], ["bad\nname"], Array(1001).fill("layer")])
      expect(() => parseHiddenCadLayers(value)).toThrow(/JSON 数组/)
  })
})

describe("CAD SVG white background and black geometry", () => {
  it("crops the vector viewBox and CAD binding together, and allows related drawings to reuse the frame", async () => {
    const original = normalizeCadFloorplanSvg(svg, [-100, -200, 100, -100]);
    const compact = await compactCadFloorplanSvg(original, [-100, -200, 100, -100]);
    expect(compact.width).toBe(3000);
    expect(compact.crop.width).toBeLessThan(original.width);
    expect(compact.crop.sourceImage).toEqual({ width: 3000, height: 1500 });
    expect(compact.window[0]).toBeGreaterThan(-100);
    const same = await compactCadFloorplanSvg(original, [-100, -200, 100, -100], compact.crop);
    expect(same.window).toEqual(compact.window);
    expect(same.svg).toBe(compact.svg);
    await expect(compactCadFloorplanSvg(original, [-100, -200, 100, -100], { left: 1000, top: 400, width: 500, height: 100 })).rejects.toThrow(/无法完整容纳/);
  });
  it("preserves coordinate ratio, removes the exporter background and thickens strokes without filling open lines", async () => {
    const result = normalizeCadFloorplanSvg(svg, [0, 0, 200, 100])
    expect(result).toMatchObject({ width: 3000, height: 1500, strokePixels: 1.6 })
    expect(result.svg).not.toMatch(/#202020|#aaaaaa|#ff0000|stroke-opacity="0.3"/)
    expect(result.svg.match(/fill="#ffffff"/g)).toHaveLength(1)
    expect(result.svg).toMatch(/polyline fill="none" stroke="#000000"/)
    expect(result.svg).toContain('stroke-width="0.10666666666666667"')
    const root = await mkdtemp(join(tmpdir(), "fmkj-cad-svg-test-")); roots.push(root)
    const png = join(root, "base.png")
    await rasterizeCadFloorplan(result.svg, png)
    const image = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect(image.info).toMatchObject({ width: 3000, height: 1500, channels: 3 })
    expect([...image.data.subarray(0, 3)]).toEqual([255, 255, 255])
    const linePixel = (750 * 3000 + 1500) * 3
    // Anti-aliasing at a subpixel stroke edge is grey, while all source colour is gone.
    expect(image.data[linePixel]).toBeLessThan(64)
    expect([...image.data.subarray(linePixel, linePixel + 3)]).toEqual(Array(3).fill(image.data[linePixel]))
    const solidPixel = (375 * 3000 + 450) * 3
    expect([...image.data.subarray(solidPixel, solidPixel + 3)]).toEqual([0, 0, 0])
  })
  it("rejects changed proportions and SVG content that could load or execute anything", () => {
    expect(() => normalizeCadFloorplanSvg(svg, [0, 0, 100, 100])).toThrow(/比例/)
    for (const payload of ['<image href="https://example.test/a.png"/>', '<script>run()</script>', '<style>@import "https://example.test/style";</style>', '<path fill="url(https://example.test/fill)"/>'])
      expect(() => normalizeCadFloorplanSvg(svg.replace("</svg>", payload + "</svg>"), [0, 0, 200, 100])).toThrow()
  })
  it("handles portrait windows and inline colour/opacity overrides", () => {
    const input = '<svg viewBox="0 0 100 200"><line fill="none" fill-opacity="0.2" stroke="red" stroke-opacity="0.1" style="stroke:blue;stroke-width:0.01;opacity:0.2" x1="10" y1="20" x2="90" y2="20"/></svg>'
    const result = normalizeCadFloorplanSvg(input, [-100, -200, 0, 0])
    expect(result).toMatchObject({ width: 1500, height: 3000 })
    expect(result.svg).toContain('fill-opacity="1"')
    expect(result.svg).toContain('stroke-opacity="1"')
    expect(result.svg).toContain('style="stroke:#000000;stroke-width:0.10666666666666667;opacity:1"')
  })
})

describe("CAD preparation protects source and output paths", () => {
  it("cleans only a derived copy and archives locked black geometry, PNG and matching CAD binding", async () => {
    const options = await fixture()
    const hideLayersPath = join(options.root, "hidden.json")
    await writeFile(hideLayersPath, JSON.stringify(["electrical"]))
    const before = await readFile(options.source)
    const cad = fakeCad(options.source)
    const result = await prepareCadFloorplan({ ...options, hideLayersPath }, fakeDependencies(cad))
    expect(cad.client.closed).toBe(true)
    expect(await readFile(options.source)).toEqual(before)
    expect(cad.entities().map((entity) => entity.type)).toEqual(["Line", "Hatch"])
    expect(cad.entities().every((entity) => entity.layer === "FMKJ_BASE" && entity.color === "ByLayer")).toBe(true)
    expect(result.counts).toMatchObject({ selected: 5, explodeRounds: [1], removed: 9, kept: 2, removedByReason: { hiddenLayer: 3, invisible: 1, annotation: 3, raster: 1, patternHatch: 1 } })
    expect(result.source).toMatchObject({ sha256: sha256(before), preserved: true })
    expect(result.selectionWindow).toEqual(options.window)
    expect(result.cad).toMatchObject({ format: "cadcraft", version: 1, window: result.window, drawingSha256: sha256(await readFile(join(options.outDir, "clean-base.dxf"))) })
    expect(result.backgroundSha256).toBe(sha256(await readFile(join(options.outDir, "clean-base.png"))))
    expect(JSON.parse(await readFile(join(options.outDir, "manifest.json"), "utf8"))).toMatchObject({ source: result.source, cad: result.cad })
    const saveCalls = cad.calls.filter((call) => call.method === "save")
    expect(saveCalls).toHaveLength(1)
    expect(saveCalls[0].args.path).not.toBe(options.source)
    expect(cad.calls.find((call) => call.method === "wblock")!.args).toMatchObject({ base: [0, 0] })
    expect(cad.calls.filter((call) => call.method === "query_entities")[0].args).toMatchObject({ crossing: false, window: [[0, 0], [200, 100]] })
  })
  it("refuses an existing output directory or symlink and leaves its contents intact", async () => {
    const options = await fixture()
    const cad = fakeCad(options.source)
    const dependencies = fakeDependencies(cad)
    await writeFile(options.outDir, "existing output")
    await expect(prepareCadFloorplan(options, dependencies)).rejects.toThrow(/已存在/)
    expect(await readFile(options.outDir, "utf8")).toBe("existing output")
    await rm(options.outDir)
    await symlink(options.root, options.outDir)
    await expect(prepareCadFloorplan(options, dependencies)).rejects.toThrow(/已存在/)
    expect(cad.calls).toHaveLength(0)
    await expect(prepareCadFloorplan({ ...options, outDir: options.source }, dependencies)).rejects.toThrow(/已存在/)
  })
  it("reuses a confirmed crop manifest and rejects a different source before opening CAD", async () => {
    const options = await fixture(), cad = fakeCad(options.source)
    const first = await prepareCadFloorplan(options, fakeDependencies(cad))
    const cropFramePath = join(options.outDir, "manifest.json")
    const second = await prepareCadFloorplan({ ...options, outDir: join(options.root, "second"), cropFramePath }, fakeDependencies(fakeCad(options.source)))
    expect(second.cad.window).toEqual(first.cad.window)
    expect(second.crop).toEqual(first.crop)
    await writeFile(options.source, "different customer drawing")
    const rejectedCad = fakeCad(options.source)
    await expect(prepareCadFloorplan({ ...options, outDir: join(options.root, "rejected"), cropFramePath }, fakeDependencies(rejectedCad))).rejects.toThrow(/同一原图/)
    expect(rejectedCad.calls).toHaveLength(0)
  })
  it("preserves native hidden variants when entity queries omit visibility and keeps only the base layer on", async () => {
    const options = await fixture(), cad = fakeCad(options.source, { omitVisibility: true })
    await prepareCadFloorplan(options, fakeDependencies(cad))
    expect(cad.entities().find((entity) => entity.handle === "hidden")).toMatchObject({ visible: false, layer: "FMKJ_BASE" })
    const propertyWrites = cad.calls.filter((call) => call.method === "properties.set")
    expect(propertyWrites.length).toBeGreaterThan(0)
    for (const call of propertyWrites) {
      expect(call.args).not.toHaveProperty("visible")
      expect(call.args).not.toHaveProperty("transparency")
      expect(Object.keys(call.args).sort()).toEqual(["color", "handles", "layer"])
    }
    expect(cad.calls.some((call) => call.args.visible === true)).toBe(false)
    expect(cad.layers().filter((layer) => layer.on).map((layer) => layer.name)).toEqual(["FMKJ_BASE"])
    expect(cad.layers().find((layer) => layer.name === "FMKJ_BASE")).toMatchObject({ on: true, frozen: false, locked: true })
  })
  it("closes the private session after cleanup failures and verifies that the source is intact", async () => {
    const options = await fixture(), before = await readFile(options.source)
    const cad = fakeCad(options.source, { failExplode: true })
    await expect(prepareCadFloorplan(options, fakeDependencies(cad))).rejects.toThrow(/explode failure/)
    expect(cad.client.closed).toBe(true)
    expect(await readFile(options.source)).toEqual(before)
    await expect(stat(join(options.outDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("limits nested exploding to eight rounds", async () => {
    const options = await fixture(), cad = fakeCad(options.source, { nested: true })
    await expect(prepareCadFloorplan(options, fakeDependencies(cad))).rejects.toThrow(/超过 8 层/)
    expect(cad.calls.filter((call) => call.method === "explode")).toHaveLength(8)
    expect(cad.client.closed).toBe(true)
  })
  it("stops oversized SVG before loading/rasterizing it", async () => {
    const options = await fixture(), cad = fakeCad(options.source)
    let rasterized = false
    await expect(prepareCadFloorplan(options, { ...fakeDependencies(cad),
      convert: async ({ svg: path }: { svg: string }) => { await writeFile(path, ""); await truncate(path, MAX_CAD_SVG_BYTES + 1) },
      rasterize: async () => { rasterized = true },
    })).rejects.toThrow(/SVG 超过 40 MB.*收紧/)
    expect(rasterized).toBe(false)
    expect(cad.client.closed).toBe(true)
  })
  it("detects external source modification before publishing a manifest", async () => {
    const options = await fixture()
    const cad = fakeCad(options.source, { afterSave: () => writeFile(options.source, "external change") })
    await expect(prepareCadFloorplan(options, fakeDependencies(cad))).rejects.toThrow(/原图指纹已改变/)
    expect(cad.client.closed).toBe(true)
    await expect(stat(join(options.outDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("performs a final source check after session close, before writing the completion marker", async () => {
    const options = await fixture(), cad = fakeCad(options.source)
    cad.client.close = async () => { cad.client.closed = true; await writeFile(options.source, "external close-time change") }
    await expect(prepareCadFloorplan(options, fakeDependencies(cad))).rejects.toThrow(/原图指纹已改变/)
    await expect(stat(join(options.outDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("times out a stalled tool and still closes the session", async () => {
    const options = await fixture(), cad = fakeCad(options.source, { neverOpen: true })
    await expect(prepareCadFloorplan(options, { ...fakeDependencies(cad), totalTimeoutMs: 20 })).rejects.toThrow(/总时限/)
    expect(cad.client.closed).toBe(true)
    expect(await readFile(options.source, "utf8")).toBe("synthetic source drawing; never overwrite")
  })
})
