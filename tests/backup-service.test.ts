import { createHash } from "node:crypto"
import { Writable } from "node:stream"
import { gzipSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"

import { tarHeader } from "../lib/backup-archive"
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, restoreBackup, schemaDigest, type BackupManifest } from "../lib/backup-service"

const COLUMNS = [
  { table_name: "projects", column_name: "name", data_type: "text", is_nullable: "NO", column_default: "" },
  { table_name: "users", column_name: "name", data_type: "text", is_nullable: "NO", column_default: "" },
]
const CSV = { projects: "name\n示例客户项目\n", users: "name\n示例账号\n" }

function database() {
  const statements: string[] = []
  const copied: string[] = []
  const release = vi.fn()
  const connect = vi.fn(async () => ({
    query(sql: unknown) {
      if (typeof sql === "string") {
        statements.push(sql)
        return Promise.resolve({ rows: [] })
      }
      return new Writable({ write(chunk, _encoding, done) { copied.push(chunk.toString()); done() } })
    },
    release,
  }))
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.columns")) return { rows: COLUMNS }
    if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "projects" }, { table_name: "users" }, { table_name: "schema_migrations" }] }
    throw new Error(`Unexpected database call: ${sql}`)
  })
  return { db: { connect, query } as never, connect, copied, release, statements }
}

async function fixture(tables = ["projects", "users"]): Promise<BackupManifest> {
  return {
    appVersion: "v0.3.5", createdAt: "2026-10-23T00:00:00.000Z", database: "synthetic", fileStorage: "local",
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, schemaDigest: await schemaDigest({ db: database().db }),
    tables: tables.map((name) => {
      const csv = CSV[name as keyof typeof CSV]
      return { name, rows: 1, bytes: Buffer.byteLength(csv), sha256: createHash("sha256").update(csv).digest("hex") }
    }),
    tablesSkipped: [], uploads: { files: 0, bytes: 0 },
  }
}

function archive(manifest: unknown, contents: Record<string, string> = CSV): Buffer {
  const files = [["manifest.json", JSON.stringify(manifest)], ...Object.entries(contents).map(([name, csv]) => [`database/${name}.csv`, csv])]
  const blocks = files.flatMap(([name, text]) => {
    const content = Buffer.from(text)
    return [tarHeader(name, content.byteLength), content, Buffer.alloc((512 - content.byteLength % 512) % 512)]
  })
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

describe("整库恢复必须使用完整备份", () => {
  it("在连接写入事务之前拒绝导出时跳过任何表的备份", async () => {
    const db = database()
    const manifest = await fixture(["projects"])
    manifest.tablesSkipped = ["users"]

    await expect(restoreBackup(archive(manifest), { db: db.db })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("导出时这些表没有备份成功：users") })
    expect(db.connect).not.toHaveBeenCalled()
    expect(db.statements).toEqual([])
  })

  it("即使跳过清单被清空，也不能用缺表的备份清空现有资料", async () => {
    const db = database()
    await expect(restoreBackup(archive(await fixture(["projects"])), { db: db.db })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("缺少这些表：users") })
    expect(db.connect).not.toHaveBeenCalled()
  })

  it("不接受空表清单，避免把整库变为空库", async () => {
    const db = database()
    await expect(restoreBackup(archive(await fixture([])), { db: db.db })).rejects.toThrow("缺少这些表：projects、users")
    expect(db.connect).not.toHaveBeenCalled()
  })

  it("不接受缺失的导出状态或重复的表清单", async () => {
    const db = database()
    const manifest = await fixture()
    const withoutSkipped: Partial<BackupManifest> = { ...manifest }
    delete withoutSkipped.tablesSkipped
    await expect(restoreBackup(archive(withoutSkipped), { db: db.db })).rejects.toThrow("清单不完整")
    manifest.tables.push(manifest.tables[0])
    await expect(restoreBackup(archive(manifest), { db: db.db })).rejects.toThrow("重复包含 projects")
    expect(db.connect).not.toHaveBeenCalled()
  })

  it("缺少表文件或内容损坏时也在写入前停止", async () => {
    const db = database()
    const manifest = await fixture()
    await expect(restoreBackup(archive(manifest, { projects: CSV.projects }), { db: db.db })).rejects.toThrow("缺少 users 的内容")
    await expect(restoreBackup(archive(manifest, { ...CSV, users: "name\n被改动\n" }), { db: db.db })).rejects.toThrow("users 内容与清单不一致")
    expect(db.connect).not.toHaveBeenCalled()
  })

  it("完整备份仍能整体恢复，并保留迁移账本", async () => {
    const db = database()
    const result = await restoreBackup(archive(await fixture()), { db: db.db, env: { FILE_STORAGE: "local" } })
    expect(result).toMatchObject({ rows: 2, tables: ["projects", "users"], warnings: [] })
    expect(db.statements).toEqual(["begin", "set local session_replication_role = replica", 'truncate "projects", "users" cascade', "commit"])
    expect(db.copied).toEqual(Object.values(CSV))
    expect(db.release).toHaveBeenCalledOnce()
  })
})
