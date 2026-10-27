import { readFileSync } from "node:fs"
import ts from "typescript"
import { describe, expect, it, vi } from "vitest"

import { prepareProjectDeliveryOutput } from "../lib/project-delivery-client"
import type { ProjectDeliverySnapshot } from "../lib/project-delivery"

const source = readFileSync(new URL("../components/projects/project-presentation.tsx", import.meta.url), "utf8")
const parsed = ts.createSourceFile("project-presentation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function productionFunction(name: string): string {
  let found: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(parsed)
  if (!found) throw new Error(`Missing production function: ${name}`)
  return found.getText(parsed)
}

// Run the actual two event handlers with browser/React boundaries supplied by the test.
// This keeps the checks about saved versions, image readiness and cancellation behavioral,
// without requiring a browser or adding a second implementation of the export flow.
function harness(options: { historical?: boolean; imageFailure?: boolean } = {}) {
  const events: string[] = []
  const fixed = {
    id: "fixed-version", version: 4, createdAt: "2026-10-23T00:00:00Z",
    project: { id: "test-project", name: "合成测试项目" },
    quote: { quoteNo: "QT-TEST", total: 125.38 },
    plan: { points: [], scenes: [] }, products: [],
  } as unknown as ProjectDeliverySnapshot
  const preview = { ...fixed, id: null, version: 0 }
  const floors = [{ id: "test-floor", name: "全屋", src: "blob:fixed-floor" }]
  const current = { projectId: "test-project", snapshot: options.historical ? fixed : preview, floors }
  const lifecycle = { current: 1 }, requestId = { current: 1 }
  const doc = { title: "客户交付" }
  let finishImages!: () => void
  const ready = new Promise<void>((resolve) => { finishImages = resolve })
  const setProposalPrint = vi.fn((value) => { events.push(value ? "mount" : "unmount") })
  const setError = vi.fn(), setPrinting = vi.fn()
  const print = vi.fn(() => { events.push("print"); expect(doc.title).toContain("V4") })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: fixed }), { headers: { "Content-Type": "application/json" } }))
  const prepareFixed = vi.fn((projectId: string, snapshot?: ProjectDeliverySnapshot) => prepareProjectDeliveryOutput(projectId, snapshot, fetcher))
  const waitForPrintImages = vi.fn(async () => {
    events.push("decode")
    await ready
    if (options.imageFailure) throw new Error("测试图片无法读取")
  })
  const showSnapshot = vi.fn(async (loader: () => Promise<ProjectDeliverySnapshot>) => ({ ...current, snapshot: await loader() }))
  const bindings = {
    data: current, dataRef: { current }, layoutDirty: false, busy: false,
    proposalTheme: "atelier", lifecycle, requestId, projectId: "test-project",
    documentBrand: { companyName: "合成测试品牌" }, document: doc, window: { print },
    proposalStyles: [{ theme: "atelier", title: "序境 · 空间提案" }],
    proposalDocumentRef: { current: { id: "proposal-root" } },
    flushSync: (callback: () => void) => callback(), setProposalPrint, setPrinting, setError,
    requestAnimationFrame: (callback: () => void) => { events.push("frame"); callback() },
    waitForPrintImages, showSnapshot, prepareProjectDeliveryOutput: prepareFixed,
  }
  const executable = ts.transpileModule(`${productionFunction("outputDelivery")}\n${productionFunction("printFirstProposal")}\nreturn { printFirstProposal };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const handlers = new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as { printFirstProposal: () => Promise<void> }
  return { ...handlers, events, fixed, floors, setProposalPrint, setPrinting, setError, print, fetcher, prepareFixed, waitForPrintImages, showSnapshot, finishImages, lifecycle, requestId, doc }
}

describe("first proposal fixed-version export", () => {
  it("turns the saved preview into one fixed version, commits it and waits before printing", async () => {
    const test = harness()
    const exporting = test.printFirstProposal()
    await vi.waitFor(() => expect(test.waitForPrintImages).toHaveBeenCalledOnce())
    expect(test.fetcher).toHaveBeenCalledOnce()
    expect(test.fetcher).toHaveBeenCalledWith("/api/projects/test-project/deliveries", { method: "POST", cache: "no-store" })
    expect(test.setProposalPrint).toHaveBeenNthCalledWith(1, { snapshot: test.fixed, floors: test.floors, theme: "atelier" })
    expect(test.events).toEqual(["mount", "frame", "frame", "decode"])
    expect(test.print).not.toHaveBeenCalled()
    test.finishImages()
    await exporting
    expect(test.events).toEqual(["mount", "frame", "frame", "decode", "print", "unmount"])
    expect(test.doc.title).toBe("客户交付")
    expect(test.setPrinting).toHaveBeenLastCalledWith(false)
  })

  it("prints the selected historical version without requesting a newer one", async () => {
    const test = harness({ historical: true })
    test.finishImages()
    await test.printFirstProposal()
    expect(test.prepareFixed).not.toHaveBeenCalled()
    expect(test.fetcher).not.toHaveBeenCalled()
    expect(test.showSnapshot).not.toHaveBeenCalled()
    expect(test.setProposalPrint).toHaveBeenNthCalledWith(1, { snapshot: test.fixed, floors: test.floors, theme: "atelier" })
    expect(test.print).toHaveBeenCalledOnce()
  })

  it.each(["project", "request"])("cancels a stale %s while images are decoding", async (change) => {
    const test = harness({ historical: true })
    const exporting = test.printFirstProposal()
    await vi.waitFor(() => expect(test.waitForPrintImages).toHaveBeenCalledOnce())
    if (change === "project") test.lifecycle.current++
    else test.requestId.current++
    test.finishImages()
    await exporting
    expect(test.print).not.toHaveBeenCalled()
    expect(test.doc.title).toBe("客户交付")
  })

  it("clears temporary print state when a required image fails", async () => {
    const test = harness({ historical: true, imageFailure: true })
    test.finishImages()
    await test.printFirstProposal()
    expect(test.print).not.toHaveBeenCalled()
    expect(test.setError).toHaveBeenLastCalledWith("测试图片无法读取")
    expect(test.setProposalPrint).toHaveBeenLastCalledWith(null)
    expect(test.setPrinting).toHaveBeenLastCalledWith(false)
    expect(test.doc.title).toBe("客户交付")
  })

  it("gives the print document its fixed data and an explicit isolation marker", () => {
    expect(source).toContain('data-proposal-print={proposalPrint ? "true" : undefined}')
    expect(source).toContain("snapshot={proposalPrint.snapshot} floors={proposalPrint.floors}")
    expect(source).toContain("documentRef={proposalDocumentRef}")
    expect(source).toContain('disabled={busy || !snapshot || layoutDirty} onClick={printFirstProposal}')
    expect(productionFunction("printPresentation")).not.toContain("setProposalPrint")
    expect(productionFunction("printFirstProposal")).not.toContain("releasePointMapPrintFloors")
  })
})
