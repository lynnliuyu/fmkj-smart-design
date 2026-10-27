import { createReadStream } from "node:fs"

/**
 * 极小的 tar 归档读写（ustar + GNU 长文件名）。
 *
 * 为什么自己写：备份要落成**一个客户能双击打开、也能用系统自带解压工具解开**的普通压缩包，
 * 而 Node 自带没有 tar。标准库里的 zlib 负责压缩，这里只负责归档格式，
 * 所以代码量小、没有新增二进制依赖。
 *
 * 只处理普通文件（typeflag 0），写入时按 ustar 的 prefix 字段拆长路径；
 * 读取时额外兼容 GNU/PAX 的长文件名，因为客户可能用系统 tar 重新打包过。
 */

const BLOCK = 512
const END_BLOCKS = Buffer.alloc(BLOCK * 2)

export type TarFileSource = {
  /** 归档内的相对路径，正斜杠分隔。 */
  name: string
  /** 磁盘上的来源文件。 */
  path: string
  size: number
}

function octal(value: number, length: number): string {
  const text = Math.max(0, Math.floor(value)).toString(8)
  return `${"0".repeat(Math.max(0, length - 1 - text.length))}${text}\0`
}

/** 名字超过 100 字节时按 `/` 拆成 prefix + name；拆不开返回 null，由调用方改用 GNU 长名条目。 */
export function splitTarName(name: string): { name: string; prefix: string } | null {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" }
  const parts = name.split("/")
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const prefix = parts.slice(0, index).join("/")
    const rest = parts.slice(index).join("/")
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { name: rest, prefix }
  }
  return null
}

function buildHeader(name: string, prefix: string, size: number, mtime: Date, typeflag: string): Buffer {
  const header = Buffer.alloc(BLOCK)

  header.write(name, 0, 100, "utf8")
  header.write(octal(0o644, 8), 100, 8, "ascii")       // mode
  header.write(octal(0, 8), 108, 8, "ascii")           // uid
  header.write(octal(0, 8), 116, 8, "ascii")           // gid
  header.write(octal(size, 12), 124, 12, "ascii")      // size
  header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, "ascii")
  header.write("        ", 148, 8, "ascii")            // 校验和先填空格
  header.write(typeflag, 156, 1, "ascii")
  header.write("ustar\0", 257, 6, "ascii")
  header.write("00", 263, 2, "ascii")
  header.write("fmkj", 265, 32, "utf8")
  header.write("fmkj", 297, 32, "utf8")
  header.write(prefix, 345, 155, "utf8")

  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii")
  return header
}

export function tarHeader(name: string, size: number, mtime = new Date()): Buffer {
  const split = splitTarName(name)
  // 拆不开时把名字截断写进普通头，真正的名字由前面的 GNU 长名条目给出。
  return split ? buildHeader(split.name, split.prefix, size, mtime, "0") : buildHeader(name.slice(0, 100), "", size, mtime, "0")
}

/**
 * 一个文件的归档头。名字太长且拆不开时，先写 GNU 的 `L` 长名条目——
 * 系统自带的 tar、7-Zip、macOS 归档工具都认这个约定，比截断安全。
 */
export function tarEntryHeaders(name: string, size: number, mtime = new Date()): Buffer[] {
  if (splitTarName(name)) return [tarHeader(name, size, mtime)]
  const payload = Buffer.from(`${name}\0`, "utf8")
  return [
    buildHeader("././@LongLink", "", payload.byteLength, mtime, "L"),
    payload,
    padding(payload.byteLength),
    tarHeader(name, size, mtime),
  ]
}

function padding(size: number): Buffer {
  const remainder = size % BLOCK
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder)
}

/** 把磁盘上的文件按顺序写成一个 tar 流（不压缩）。 */
export async function* tarStream(files: TarFileSource[], mtime = new Date()): AsyncGenerator<Buffer> {
  for (const file of files) {
    yield* tarEntryHeaders(file.name, file.size, mtime)
    for await (const chunk of createReadStream(file.path)) yield chunk as Buffer
    const pad = padding(file.size)
    if (pad.length) yield pad
  }
  yield END_BLOCKS
}

export function isSafeArchiveName(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false
  return !name.split("/").some((part) => part === "" || part === "." || part === "..")
}

function readString(block: Buffer, offset: number, length: number): string {
  const end = block.indexOf(0, offset)
  const slice = block.subarray(offset, end === -1 || end > offset + length ? offset + length : end)
  return slice.toString("utf8").trim()
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).replace(/\0/g, "").trim()
  if (!text) return 0
  const parsed = Number.parseInt(text, 8)
  return Number.isFinite(parsed) ? parsed : 0
}

export type TarEntry = { content: Buffer; name: string }

/**
 * 解析整个 tar（已是未压缩字节）。客户可能用系统 tar 重新打包过，所以同时认
 * ustar 的 prefix、GNU 的 `L` 长名字段和 PAX 的 `x` 头。
 */
export function readTarEntries(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let pendingName: string | null = null

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK)
    offset += BLOCK
    if (header.every((byte) => byte === 0)) break

    const size = readOctal(header, 124, 12)
    const content = buffer.subarray(offset, offset + size)
    offset += size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK))

    const type = String.fromCharCode(header[156] ?? 0)
    const prefix = readString(header, 345, 155)
    const short = readString(header, 0, 100)
    const name = pendingName ?? (prefix ? `${prefix}/${short}` : short)

    if (type === "L") { pendingName = content.toString("utf8").replace(/\0+$/, ""); continue }
    if (type === "x" || type === "g") {
      const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(content.toString("utf8"))
      if (match) pendingName = match[1]
      continue
    }
    pendingName = null
    // 只收普通文件：目录、符号链接、设备文件都不还原。
    if (type !== "0" && type !== "\0") continue
    if (!isSafeArchiveName(name)) throw new Error(`归档里有不安全的路径：${name}`)
    entries.push({ content: Buffer.from(content), name })
  }

  return entries
}
