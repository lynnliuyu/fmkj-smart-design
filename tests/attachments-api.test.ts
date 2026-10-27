import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const db = vi.hoisted(() => ({ query: vi.fn() }))
const session = vi.hoisted(() => ({ getCurrentAccountContext: vi.fn() }))

vi.mock("@/lib/server-db", () => ({ hasDatabaseUrl: () => true, getPool: () => ({ query: db.query }) }))
vi.mock("@/lib/account-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/account-context")>()
  return { ...actual, getCurrentAccountContext: session.getCurrentAccountContext }
})

import { buildAccountContext } from "../lib/account-context"
import { GET, POST } from "../app/api/attachments/route"

const sessionUser = { userId: "30000000-0000-0000-0000-000000000011", email: "a@example.com", name: "A", phone: null, role: "designer" }

const designer = () => buildAccountContext(sessionUser, { id: sessionUser.userId, role: "designer", status: "active" })
const disabled = () => buildAccountContext(sessionUser, { id: sessionUser.userId, role: "designer", status: "disabled" })

const post = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/attachments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })

const body = { projectId: "20000000-0000-0000-0000-000000000001", fileName: "contract.pdf", fileUrl: "https://example.com/c.pdf" }

beforeEach(() => {
  db.query.mockReset()
  session.getCurrentAccountContext.mockReset()
})

describe("attachments API authorization", () => {
  it("refuses reads by a disabled account", async () => {
    session.getCurrentAccountContext.mockResolvedValue(disabled())
    expect((await GET(new NextRequest(`http://localhost/api/attachments?projectId=${body.projectId}`))).status).toBe(403)
    expect(db.query).not.toHaveBeenCalled()
  })

  it("refuses a visible project assigned as read-only, before writing an attachment", async () => {
    session.getCurrentAccountContext.mockResolvedValue(buildAccountContext(sessionUser, { id: sessionUser.userId, role: "editor", status: "active" }, { id: "org_1", name: "Org", role: "editor" }))
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ createdBy: sessionUser.userId, accessLevel: "view" }] })
    const response = await POST(post(body))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "PROJECT_READ_ONLY" })
    expect(db.query).toHaveBeenCalledTimes(1)
  })
  it("refuses reads without a session", async () => {
    session.getCurrentAccountContext.mockResolvedValue(null)

    const response = await GET(new NextRequest("http://localhost/api/attachments?projectId=x"))

    expect(response.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it("refuses writes without a session", async () => {
    session.getCurrentAccountContext.mockResolvedValue(null)

    const response = await POST(post(body))

    expect(response.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it("refuses writes when the account may not edit projects", async () => {
    session.getCurrentAccountContext.mockResolvedValue(disabled())

    const response = await POST(post(body))

    expect(response.status).toBe(403)
    expect(db.query).not.toHaveBeenCalled()
  })

  it("refuses writes to a project outside the account scope", async () => {
    session.getCurrentAccountContext.mockResolvedValue(designer())
    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const response = await POST(post(body))

    expect(response.status).toBe(404)
    // The insert must not run when the visibility check came back empty.
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it("attributes the attachment to the session user, not a fixed account", async () => {
    session.getCurrentAccountContext.mockResolvedValue(designer())
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] })
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "40000000-0000-0000-0000-000000000001", projectId: body.projectId }] })

    const response = await POST(post(body))

    expect(response.status).toBe(200)
    const insert = db.query.mock.calls[1]
    expect(String(insert[0])).toContain("insert into project_attachments")
    expect(insert[1][0]).toBe(sessionUser.userId)
  })

  it("applies project visibility to reads instead of trusting projectId alone", async () => {
    session.getCurrentAccountContext.mockResolvedValue(designer())
    db.query.mockResolvedValueOnce({ rows: [] })

    const response = await GET(new NextRequest(`http://localhost/api/attachments?projectId=${body.projectId}`))

    expect(response.status).toBe(200)
    const [sql, params] = db.query.mock.calls[0]
    expect(String(sql)).toContain("join projects p on p.id = a.project_id")
    expect(String(sql)).toContain("coalesce(p.owner_type, 'user') = 'user'")
    expect(params[1]).toBe(sessionUser.userId)
  })
})
