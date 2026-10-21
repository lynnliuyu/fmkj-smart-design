import { describe, expect, it, vi } from "vitest"
import { refreshPointMapQuote } from "../lib/point-map-quote-refresh"

const project = "project-a"
const payload = (items: unknown[] = []) => ({ blocked: false, included: items.length, excluded: 2, unverified: [], data: { projectId: project, revision: 4, items } })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe("saved point-map to local quote preview", () => {
  it("uses the just-saved revision and publishes an empty snapshot to remove previous sourced rows", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(payload()))
    const publish = vi.fn()
    expect(await refreshPointMapQuote(project, "Project A", { expectedRevision: 4, fetcher, publish })).toEqual({ updated: true, included: 0, excluded: 2, unverified: 0 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).expectedRevision).toBe(4)
    expect(publish).toHaveBeenCalledWith({ projectId: project, revision: 4, items: [] })
  })
  it("loads a revision for project model changes and leaves the database quote untouched", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ revision: 4 })).mockResolvedValueOnce(response(payload([{ id: "product", project: "wrong name" }])))
    const publish = vi.fn()
    await refreshPointMapQuote(project, "Project A", { fetcher, publish })
    expect(publish.mock.calls[0][0].items[0].project).toBe("Project A")
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`/api/projects/${project}/point-map`, `/api/projects/${project}/point-map/quote-preview`])
  })
  it.each([
    [payload(), false],
    [{ ...payload(), data: { projectId: "other", revision: 4, items: [] } }, true],
    [{ ...payload(), data: { projectId: project, revision: 5, items: [] } }, true],
    [{ blocked: true, diagnostics: [{}] }, true],
  ])("does not replace a preview after supersession or source conflict", async (body, current) => {
    const publish = vi.fn()
    const result = await refreshPointMapQuote(project, "A", { expectedRevision: 4, fetcher: vi.fn(async () => response(body)), publish, isCurrent: () => current })
    expect(result.updated).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })
  it("reports a server conflict and never retries with another revision", async () => {
    const fetcher = vi.fn(async () => response({ error: "点位版本已变化" }, 409))
    const publish = vi.fn()
    expect(await refreshPointMapQuote(project, "A", { expectedRevision: 4, fetcher, publish })).toEqual({ updated: false, message: "点位版本已变化" })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
  })
  it("reports a bounded timeout instead of leaving the workbench stuck on saving", async () => {
    const fetcher = vi.fn(async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }) })
    const publish = vi.fn()
    expect(await refreshPointMapQuote(project, "A", { expectedRevision: 4, fetcher, publish, timeoutMs: 1 })).toEqual({ updated: false, message: "报价预览同步超时，请稍后再次保存草稿重试。" })
    expect(publish).not.toHaveBeenCalled()
  })
})
