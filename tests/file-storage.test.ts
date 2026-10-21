import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { canReadLocalFile } from "../lib/file-access"
import {
  LOCAL_FILE_PREFIX,
  buildObjectKey,
  contentTypeFor,
  fileStorage,
  isInlineImage,
  objectPathFor,
  readLocalFile,
  safeSegment,
  selectedProvider,
} from "../lib/file-storage"

const roots: string[] = []

beforeEach(() => {
  delete process.env.FILE_STORAGE
  delete process.env.BLOB_READ_WRITE_TOKEN
  delete process.env.FMKJ_STORAGE_ROOT
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  delete process.env.FILE_STORAGE
  delete process.env.BLOB_READ_WRITE_TOKEN
  delete process.env.FMKJ_STORAGE_ROOT
})

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "fmkj-files-"))
  roots.push(dir)
  process.env.FMKJ_STORAGE_ROOT = dir
  return dir
}

describe("附件存储的供应商选择", () => {
  it("prefers an explicit switch over the ambient token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token"
    expect(selectedProvider()).toBe("blob")
    process.env.FILE_STORAGE = "local"
    expect(selectedProvider()).toBe("local")
  })

  it("falls back to the local volume so a self-hosted device is not stuck on a 500", () => {
    expect(selectedProvider()).toBe("local")
  })
})

describe("附件路径安全", () => {
  it("strips anything that could escape the storage root", () => {
    expect(safeSegment("../../etc/passwd")).toBe("etc-passwd")
    // 纯中文名被剥离后不会产生空段或路径分隔符
    expect(safeSegment("项目 图纸.png")).not.toContain("/")
    expect(safeSegment("项目 图纸.png")).not.toContain("..")
    expect(safeSegment("")).toBe("file")
    expect(safeSegment("a".repeat(300)).length).toBeLessThanOrEqual(120)
  })

  it("rejects traversal and absolute paths", () => {
    expect(() => objectPathFor("/data/uploads", "product-images/../secret")).toThrow()
    expect(() => objectPathFor("/data/uploads", "product-images/./x.png")).toThrow()
    expect(() => objectPathFor("/data/uploads", "")).toThrow()
  })

  it("keeps a legitimate nested key inside the root", () => {
    expect(objectPathFor("/data/uploads", "product-images/p1/123-a.png")).toBe(
      "/data/uploads/product-images/p1/123-a.png",
    )
  })

  it("builds keys that are already safe to serve back", () => {
    const key = buildObjectKey({ kind: "product-images", ownerId: "p1", filename: "客厅 现场.JPG" })
    expect(key).toMatch(/^product-images\/p1\/\d+-[0-9a-f]{8}-/)
    // 扩展名必须保留，否则读取时无法判断 Content-Type
    expect(key.endsWith(".jpg")).toBe(true)
    expect(() => objectPathFor("/data/uploads", key)).not.toThrow()
  })
})

describe("附件的响应类型", () => {
  it("only inlines raster images so SVG and documents cannot run on our origin", () => {
    expect(isInlineImage("photo.png")).toBe(true)
    expect(isInlineImage("photo.JPG")).toBe(true)
    expect(isInlineImage("plan.svg")).toBe(false)
    expect(isInlineImage("contract.pdf")).toBe(false)
  })

  it("maps known extensions and falls back to a download", () => {
    expect(contentTypeFor("a.webp")).toBe("image/webp")
    expect(contentTypeFor("a.pdf")).toBe("application/pdf")
    expect(contentTypeFor("a.unknown")).toBe("application/octet-stream")
  })
})

describe("本地存储读写", () => {
  it("saves bytes to the volume and reads them back through the guard", async () => {
    const root = await tempRoot()
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const stored = await fileStorage().save({
      kind: "product-images",
      ownerId: "product-1",
      filename: "hero.png",
      bytes,
      contentType: "image/png",
    })
    expect(stored.provider).toBe("local")
    expect(stored.url.startsWith(LOCAL_FILE_PREFIX)).toBe(true)
    expect(stored.pathname.startsWith("product-images/product-1/")).toBe(true)

    const read = await readLocalFile(stored.pathname)
    expect(read && [...read.bytes]).toEqual([...bytes])
    expect(read?.contentType).toBe("image/png")
    // 文件确实落在配置的数据卷里
    await expect(readFile(join(root, stored.pathname))).resolves.toBeTruthy()
  })

  it("removes a stored file and refuses to read it afterwards", async () => {
    await tempRoot()
    const stored = await fileStorage().save({
      kind: "contracts",
      ownerId: "project-1",
      filename: "合同.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
      contentType: "application/pdf",
    })
    await fileStorage().remove(stored.url)
    expect(await readLocalFile(stored.pathname)).toBeNull()
  })

  it("does not fall over when the same file is removed twice", async () => {
    await tempRoot()
    const stored = await fileStorage().save({
      kind: "avatars",
      ownerId: "user-1",
      filename: "me.png",
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    })
    await fileStorage().remove(stored.url)
    await expect(fileStorage().remove(stored.url)).resolves.toBeUndefined()
  })

  it("returns null instead of throwing for a traversing path", async () => {
    await tempRoot()
    expect(await readLocalFile("../../etc/passwd")).toBeNull()
  })
})

describe("附件读取授权", () => {
  const attachmentRow = (projectId: string) => async (sql: string) =>
    sql.includes("project_attachments") ? { rows: [{ projectId }] } : { rows: [] }

  it("denies when the project is not visible to this account", async () => {
    expect(
      await canReadLocalFile("contracts/p1/1-c.pdf", {
        query: attachmentRow("p1"),
        canSeeProject: async () => false,
      }),
    ).toBe(false)
  })

  it("matches project attachments by their stored in-site url", async () => {
    const paramsSeen: unknown[][] = []
    const allowed = await canReadLocalFile("contracts/p2/1-c.pdf", {
      query: async (sql, params) => {
        paramsSeen.push(params)
        return attachmentRow("p2")(sql)
      },
      canSeeProject: async () => true,
    })
    expect(allowed).toBe(true)
    // 现场照片下线后，附件查询是这条路径上的第一个（也是唯一一个）记录查询。
    expect(paramsSeen[0]).toEqual(["/api/files/contracts/p2/1-c.pdf"])
  })

  it("treats catalog and personal images as deployment-wide, but nothing else", async () => {
    const deps = { query: async () => ({ rows: [] }), canSeeProject: async () => false }
    expect(await canReadLocalFile("product-images/p/1-hero.png", deps)).toBe(true)
    expect(await canReadLocalFile("avatars/u/1-me.png", deps)).toBe(true)
    // 未登记的路径不能因为「查不到记录」就被放行
    expect(await canReadLocalFile("contracts/p1/1-a.pdf", deps)).toBe(false)
    expect(await canReadLocalFile("secret/1-x.txt", deps)).toBe(false)
  })

  it("denies an empty path", async () => {
    expect(
      await canReadLocalFile("", { query: async () => ({ rows: [] }), canSeeProject: async () => true }),
    ).toBe(false)
  })
})
