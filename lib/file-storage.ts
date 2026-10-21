import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * 附件存储适配层。ADR 0010 要求「本地目录/数据卷和线上对象存储使用同一业务接口」，
 * 所以调用方只认这里的 save/remove/read，不再直接依赖 @vercel/blob。
 *
 * 供应商选择：
 *   FILE_STORAGE=local|blob 显式指定；
 *   未指定时——配了 BLOB_READ_WRITE_TOKEN 用 blob（保持既有托管行为），
 *   否则落本地数据卷（本地设备版默认，不再 500 BLOB_STORE_NOT_CONFIGURED）。
 */
export const LOCAL_FILE_PREFIX = "/api/files/"
export const DEFAULT_STORAGE_ROOT = "/data/uploads"

export type StorageProvider = "local" | "blob"

export type StoredFile = {
  provider: StorageProvider
  /** 站内可访问地址；本地实现是 /api/files/<pathname>。 */
  url: string
  /** 供应商内部路径（本地即相对数据卷的路径）。 */
  pathname: string
  downloadUrl: string
  size: number
  contentType: string
}

export type SaveFileInput = {
  /** 目录用途，例如 contracts、product-images。 */
  kind: string
  /** 归属实体，例如项目 ID、工单 ID、账号 ID。 */
  ownerId: string
  filename: string
  bytes: Uint8Array
  contentType: string
}

export type FileStorage = {
  provider: StorageProvider
  save(input: SaveFileInput): Promise<StoredFile>
  remove(url: string): Promise<void>
}

/** 只允许字母数字和 . _ -，避免路径穿越和编码歧义。 */
export function safeSegment(value: string, fallback = "file"): string {
  const cleaned = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  return cleaned.slice(0, 120) || fallback
}

export function storageRoot(): string {
  const configured = process.env.FMKJ_STORAGE_ROOT?.trim()
  if (configured) return configured
  // 未配置时落在忽略目录里，方便本机开发；容器里由 compose 指定数据卷。
  return path.join(process.cwd(), ".local", "uploads")
}

export function selectedProvider(): StorageProvider {
  const configured = process.env.FILE_STORAGE?.trim().toLowerCase()
  if (configured === "local" || configured === "blob") return configured
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local"
}

/**
 * 把站内路径解析成磁盘路径，并确认结果仍在存储根内。
 * 这是防路径穿越的唯一入口：所有读写都必须走它。
 */
export function objectPathFor(root: string, pathname: string): string {
  const segments = String(pathname ?? "").split("/").filter(Boolean)
  if (!segments.length) throw new Error("文件路径为空")
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))
      throw new Error("文件路径无效")
    if (segment !== safeSegment(segment)) throw new Error("文件路径含非法字符")
  }
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, ...segments)
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep))
    throw new Error("文件路径超出存储范围")
  return target
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

export function contentTypeFor(name: string): string {
  const extension = String(name).split(".").pop()?.toLowerCase() ?? ""
  return CONTENT_TYPES[extension] ?? "application/octet-stream"
}

/**
 * 只有标准位图可以内联展示。SVG 能携带脚本，PDF/Office 可能带宏，
 * 一律按附件下载并加 CSP，避免用户上传的文件在站点源上执行。
 */
export function isInlineImage(name: string): boolean {
  const type = contentTypeFor(name)
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(type)
}

export function buildObjectKey(input: { kind: string; ownerId: string; filename: string }, now = new Date()): string {
  // 扩展名单独处理：safeSegment 会剥掉首尾的点，直接套用会连 ".png" 一起吃掉，
  // 于是文件既没有类型也读不出正确 Content-Type。
  const rawExtension = input.filename.includes(".") ? (input.filename.split(".").pop() ?? "") : ""
  const extension = safeSegment(rawExtension, "")
  const base = safeSegment(input.filename.replace(/\.[^.]+$/, ""), "file")
  const stamp = now.getTime()
  return `${safeSegment(input.kind, "attachments")}/${safeSegment(input.ownerId, "general")}/${stamp}-${randomUUID().slice(0, 8)}-${base}${extension ? `.${extension.toLowerCase()}` : ""}`
}

async function localSave(input: SaveFileInput): Promise<StoredFile> {
  const key = buildObjectKey(input)
  const target = objectPathFor(storageRoot(), key)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, input.bytes)
  const url = LOCAL_FILE_PREFIX + key
  return { provider: "local", url, pathname: key, downloadUrl: url, size: input.bytes.byteLength, contentType: input.contentType }
}

async function blobSave(input: SaveFileInput): Promise<StoredFile> {
  const { put } = await import("@vercel/blob")
  const key = buildObjectKey(input)
  const blob = await put(key, Buffer.from(input.bytes), { access: "public", addRandomSuffix: false, contentType: input.contentType })
  return { provider: "blob", url: blob.url, pathname: blob.pathname, downloadUrl: blob.downloadUrl, size: input.bytes.byteLength, contentType: input.contentType }
}

/** 读取本地存储的文件；路径不合法或文件不存在返回 null，不抛错给调用方。 */
export async function readLocalFile(pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (selectedProvider() !== "local") return null
  try {
    const target = objectPathFor(storageRoot(), pathname)
    const bytes = await readFile(target)
    return { bytes, contentType: contentTypeFor(pathname) }
  } catch {
    return null
  }
}

export async function removeLocalFile(urlOrPathname: string): Promise<void> {
  const pathname = urlOrPathname.startsWith(LOCAL_FILE_PREFIX)
    ? urlOrPathname.slice(LOCAL_FILE_PREFIX.length)
    : urlOrPathname
  await rm(objectPathFor(storageRoot(), pathname), { force: true })
}

let cached: FileStorage | undefined

export function fileStorage(): FileStorage {
  if (cached) return cached
  const provider = selectedProvider()
  cached = provider === "blob"
    ? {
        provider,
        save: blobSave,
        remove: async (url) => {
          if (url.startsWith(LOCAL_FILE_PREFIX)) return removeLocalFile(url)
          const { del } = await import("@vercel/blob")
          await del([url])
        },
      }
    : { provider, save: localSave, remove: removeLocalFile }
  return cached
}
