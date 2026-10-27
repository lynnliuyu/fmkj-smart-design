import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { gunzipSync } from "node:zlib"
import { from as copyFrom, to as copyTo } from "pg-copy-streams"

import { getPool } from "./server-db"
import { isSafeArchiveName, readTarEntries, type TarFileSource } from "./backup-archive"

/**
 * 客户自助备份：把整个业务库和上传的文件打成一个包，客户自己下载保存；
 * 出事时再把包传回来恢复。
 *
 * 三个设计决定：
 *   1. 备份的是**整库**（业务数据 + 账号配置 + 上传附件），不是单个项目——客户要的是「一键全留底」。
 *   2. 导出走 PostgreSQL 自己的 `COPY`，不是手写序列化：类型（jsonb、数组、时间戳）由数据库负责，
 *      少一类字段就少一类还原事故。
 *   3. 恢复放在**一个事务**里：结构不匹配、内容被改动、中途出错，都整体回滚，不会留下半个库。
 *
 * ADR 0010：全程在业务应用里完成，不碰 docker socket、不执行宿主机命令。
 * 代价是「应用起不来时网页也打不开」——那种情况用设备上的 `scripts/deploy/backup-local.mjs`
 * 与文档里的宿主机恢复步骤兜底。
 */

export const BACKUP_FORMAT = "fmkj-backup"
export const BACKUP_FORMAT_VERSION = 1
/** 恢复上传的上限：设备内存有限，超过就请客户拆分或走宿主机脚本。 */
export const MAX_RESTORE_BYTES = 1024 * 1024 * 1024

/** 迁移账本不进备份：它描述的是「现在的结构」，恢复它反而会把结构记录改错。 */
const EXCLUDED_TABLES = new Set(["schema_migrations"])

export type BackupTableEntry = { bytes: number; name: string; rows: number; sha256: string }

export type BackupManifest = {
  appVersion: string
  createdAt: string
  database: string | null
  fileStorage: "blob" | "local"
  format: string
  formatVersion: number
  schemaDigest: string
  tables: BackupTableEntry[]
  tablesSkipped: string[]
  uploads: { bytes: number; files: number }
}

export type PreparedBackup = {
  cleanup: () => Promise<void>
  files: TarFileSource[]
  manifest: BackupManifest
  totalBytes: number
}

export type BackupDependencies = {
  db?: Pick<ReturnType<typeof getPool>, "query" | "connect">
  env?: Record<string, string | undefined>
  storageRoot?: string
}

function db(dependencies: BackupDependencies) {
  return dependencies.db ?? getPool()
}

function storageRoot(dependencies: BackupDependencies): string {
  const env = dependencies.env ?? process.env
  return dependencies.storageRoot ?? env.FMKJ_STORAGE_ROOT ?? "/data/uploads"
}

function fileStorageMode(dependencies: BackupDependencies): "blob" | "local" {
  const env = dependencies.env ?? process.env
  if (env.FILE_STORAGE === "blob") return "blob"
  if (env.FILE_STORAGE === "local") return "local"
  return env.BLOB_READ_WRITE_TOKEN ? "blob" : "local"
}

/** 结构指纹：表和列的形状。比对着它就能判断「这份备份是不是这一版软件的」。 */
export async function schemaDigest(dependencies: BackupDependencies = {}): Promise<string> {
  const result = await db(dependencies).query(
    `select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as column_default
     from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position`,
  )
  const text = result.rows
    .map((row: Record<string, unknown>) => [row.table_name, row.column_name, row.data_type, row.is_nullable, row.column_default].join("|"))
    .join("\n")
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)
}

export async function listBackupTables(dependencies: BackupDependencies = {}): Promise<string[]> {
  const result = await db(dependencies).query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  )
  return result.rows
    .map((row: Record<string, unknown>) => String(row.table_name))
    .filter((name: string) => !EXCLUDED_TABLES.has(name))
}

async function tableRowCount(dependencies: BackupDependencies, table: string): Promise<number> {
  const result = await db(dependencies).query(`select count(*)::int as count from "${table}"`)
  return Number((result.rows[0] as { count?: number })?.count ?? 0)
}

async function writeTableCsv(dependencies: BackupDependencies, table: string, target: string): Promise<void> {
  const client = await (db(dependencies) as ReturnType<typeof getPool>).connect()
  try {
    // 带列名的 CSV：恢复时同样按列名匹配，列顺序变了也不会串。
    const stream = client.query(copyTo(`COPY (SELECT * FROM "${table}") TO STDOUT WITH (FORMAT csv, HEADER)`))
    await pipeline(stream, createWriteStream(target))
  } finally {
    client.release()
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  hash.update(await readFile(path))
  return hash.digest("hex")
}

/** 递归列出上传目录；目录不存在（例如用对象存储）时返回空数组。 */
async function listUploadFiles(root: string, current = root): Promise<Array<{ path: string; rel: string; size: number }>> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return []
  }
  const files: Array<{ path: string; rel: string; size: number }> = []
  for (const entry of entries) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...await listUploadFiles(root, path))
    else if (entry.isFile()) {
      const info = await stat(path)
      files.push({ path, rel: relative(root, path).split(sep).join("/"), size: info.size })
    }
  }
  return files
}

/**
 * 生成一份备份包（落在临时目录），调用方负责把它流出去并 `cleanup()`。
 */
export async function prepareBackup(dependencies: BackupDependencies = {}): Promise<PreparedBackup> {
  const workdir = await mkdtemp(join(tmpdir(), "fmkj-backup-"))
  const databaseDir = join(workdir, "database")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(databaseDir, { recursive: true })

  const tables = await listBackupTables(dependencies)
  const entries: BackupTableEntry[] = []
  const skipped: string[] = []
  const files: TarFileSource[] = []

  for (const table of tables) {
    const target = join(databaseDir, `${table}.csv`)
    try {
      await writeTableCsv(dependencies, table, target)
      const info = await stat(target)
      entries.push({ bytes: info.size, name: table, rows: await tableRowCount(dependencies, table), sha256: await sha256File(target) })
      files.push({ name: `database/${table}.csv`, path: target, size: info.size })
    } catch {
      // 单表导出失败不拖垮整份备份，但要在清单里如实写出来，不能假装成功。
      skipped.push(table)
      await rm(target, { force: true })
    }
  }

  const mode = fileStorageMode(dependencies)
  const uploads = mode === "local" ? await listUploadFiles(storageRoot(dependencies)) : []
  for (const file of uploads) {
    if (!isSafeArchiveName(file.rel)) continue
    files.push({ name: `uploads/${file.rel}`, path: file.path, size: file.size })
  }

  const identity = await db(dependencies).query("select current_database() as database")
  const manifest: BackupManifest = {
    appVersion: (dependencies.env ?? process.env).FMKJ_VERSION ?? "",
    createdAt: new Date().toISOString(),
    database: (identity.rows[0] as { database?: string })?.database ?? null,
    fileStorage: mode,
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaDigest: await schemaDigest(dependencies),
    tables: entries,
    tablesSkipped: skipped,
    uploads: { bytes: uploads.reduce((sum, file) => sum + file.size, 0), files: uploads.length },
  }

  const manifestPath = join(workdir, "manifest.json")
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(manifestPath, manifestText, "utf8")
  const manifestSize = Buffer.byteLength(manifestText, "utf8")

  return {
    cleanup: async () => { await rm(workdir, { recursive: true, force: true }) },
    files: [{ name: "manifest.json", path: manifestPath, size: manifestSize }, ...files],
    manifest,
    totalBytes: files.reduce((sum, file) => sum + file.size, manifestSize),
  }
}

export type RestoreResult = {
  appVersion: string
  createdAt: string
  rows: number
  tables: string[]
  uploads: { files: number; warning: string | null }
  warnings: string[]
}

export class BackupRestoreError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "BackupRestoreError"
    this.status = status
  }
}

function readManifest(entries: ReturnType<typeof readTarEntries>): BackupManifest {
  const entry = entries.find((item) => item.name === "manifest.json")
  if (!entry) throw new BackupRestoreError("这个文件不是本系统的备份包（里面没有 manifest.json）")
  let parsed: BackupManifest
  try {
    parsed = JSON.parse(entry.content.toString("utf8")) as BackupManifest
  } catch {
    throw new BackupRestoreError("备份包里的 manifest.json 读不出来，文件可能损坏")
  }
  if (parsed?.format !== BACKUP_FORMAT) throw new BackupRestoreError("这个文件不是本系统的备份包")
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupRestoreError(`备份包版本 ${parsed.formatVersion} 与当前软件（${BACKUP_FORMAT_VERSION}）不一致`)
  }
  if (!Array.isArray(parsed.tables) || !Array.isArray(parsed.tablesSkipped) || parsed.tablesSkipped.some((name) => typeof name !== "string")) {
    throw new BackupRestoreError("备份包的清单不完整")
  }
  if (parsed.tablesSkipped.length) {
    throw new BackupRestoreError(`这份备份不完整，导出时这些表没有备份成功：${parsed.tablesSkipped.join("、")}。不能用它整体恢复，请重新导出完整备份或改用设备上的宿主机恢复步骤`)
  }
  return parsed
}

/**
 * 从备份包恢复：先校验（格式、结构指纹、每张表的内容摘要），再在一个事务里整体替换。
 * 任何一步不过就整批回滚，本地数据保持原样。
 */
export async function restoreBackup(archive: Buffer, dependencies: BackupDependencies = {}): Promise<RestoreResult> {
  if (archive.byteLength > MAX_RESTORE_BYTES) {
    throw new BackupRestoreError(`备份包超过 ${Math.round(MAX_RESTORE_BYTES / 1024 / 1024)}MB，请用设备上的宿主机脚本恢复`, 413)
  }

  let entries
  try {
    entries = readTarEntries(gunzipSync(archive))
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error
    throw new BackupRestoreError("备份包解不开：请确认上传的是本系统导出的 .tar.gz 文件，且传输完整")
  }

  const manifest = readManifest(entries)
  const localDigest = await schemaDigest(dependencies)
  if (manifest.schemaDigest !== localDigest) {
    throw new BackupRestoreError("这份备份来自结构不同的版本，不能直接恢复：请先把软件升到导出备份时的版本，或改用设备上的宿主机恢复步骤")
  }

  const localTables = new Set(await listBackupTables(dependencies))
  const csvByTable = new Map<string, Buffer>()
  for (const table of manifest.tables) {
    if (!table || typeof table.name !== "string") throw new BackupRestoreError("备份包的表清单不完整")
    if (!localTables.has(table.name)) throw new BackupRestoreError(`备份里的表 ${table.name} 在本机不存在`)
    if (csvByTable.has(table.name)) throw new BackupRestoreError(`备份包的表清单重复包含 ${table.name}`)
    const entry = entries.find((item) => item.name === `database/${table.name}.csv`)
    if (!entry) throw new BackupRestoreError(`备份包缺少 ${table.name} 的内容`)
    if (createHash("sha256").update(entry.content).digest("hex") !== table.sha256) {
      throw new BackupRestoreError(`备份包里的 ${table.name} 内容与清单不一致，可能在传输中损坏`)
    }
    csvByTable.set(table.name, entry.content)
  }
  const missingTables = [...localTables].filter((name) => !csvByTable.has(name))
  if (missingTables.length) {
    throw new BackupRestoreError(`这份备份不完整，缺少这些表：${missingTables.join("、")}。本机数据未被改动，请使用完整备份`)
  }

  const client = await (db(dependencies) as ReturnType<typeof getPool>).connect()
  let rows = 0
  try {
    await client.query("begin")
    // 关掉外键触发器，按表逐张载入：产品/项目之间有自引用与环状约束，靠行顺序排不开。
    // 这是事务级的 SET LOCAL，提交或回滚后自动失效。
    await client.query("set local session_replication_role = replica")
    const truncate = [...localTables].map((name) => `"${name}"`).join(", ")
    if (truncate) await client.query(`truncate ${truncate} cascade`)

    for (const table of manifest.tables) {
      const csv = csvByTable.get(table.name) ?? Buffer.alloc(0)
      const stream = client.query(copyFrom(`COPY "${table.name}" FROM STDIN WITH (FORMAT csv, HEADER)`))
      await pipeline(Readable.from(csv), stream)
      rows += table.rows
    }

    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    if (/session_replication_role|must be superuser/i.test(message)) {
      throw new BackupRestoreError("当前数据库账号没有恢复权限（需要超级用户）。设备自带库默认可以，外部数据库请改用宿主机恢复步骤")
    }
    throw new BackupRestoreError(`恢复失败，已整体回滚，本地数据未被改动：${message.slice(0, 300)}`, 500)
  } finally {
    client.release()
  }

  // 文件在数据库提交之后写：库是原子的，附件是「只增不删」，宁可留孤儿文件也不删可能还被引用的文件。
  let uploadFiles = 0
  let uploadWarning: string | null = null
  if (fileStorageMode(dependencies) === "local") {
    const root = storageRoot(dependencies)
    try {
      for (const entry of entries) {
        if (!entry.name.startsWith("uploads/")) continue
        const target = resolve(root, entry.name.slice("uploads/".length))
        if (!target.startsWith(resolve(root) + sep)) continue
        const { mkdir } = await import("node:fs/promises")
        await mkdir(resolve(target, ".."), { recursive: true })
        await writeFile(target, entry.content)
        uploadFiles += 1
      }
    } catch (error) {
      uploadWarning = `附件恢复未全部完成：${error instanceof Error ? error.message : error}`
    }
  } else {
    uploadWarning = "当前使用对象存储（FILE_STORAGE=blob），备份包里的附件没有写回本地"
  }

  const warnings: string[] = []
  if (uploadWarning) warnings.push(uploadWarning)

  return {
    appVersion: manifest.appVersion,
    createdAt: manifest.createdAt,
    rows,
    tables: manifest.tables.map((table) => table.name),
    uploads: { files: uploadFiles, warning: uploadWarning },
    warnings,
  }
}
