import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"

import { isSafeArchiveName, readTarEntries, splitTarName, tarHeader, tarStream } from "../lib/backup-archive"

const cleanups: string[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function workdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fmkj-tar-"))
  cleanups.push(dir)
  return dir
}

async function collect(files: Parameters<typeof tarStream>[0]): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of tarStream(files)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe("归档格式", () => {
  it("写出来的 tar 能被系统自带的 tar 认出并列出文件名（真互操作，不是自己读自己）", async () => {
    const dir = await workdir()
    const target = join(dir, "中文文件.csv")
    await writeFile(target, "系统货号,产品名称\nA-1,开关\n", "utf8")

    const archive = await collect([{ name: "database/products.csv", path: target, size: Buffer.byteLength("系统货号,产品名称\nA-1,开关\n") }])
    const gz = join(dir, "backup.tar.gz")
    await writeFile(gz, gzipSync(archive))

    // 用 macOS/Linux 自带 tar 列出内容：能列出来才说明格式是对的。
    const listed = execFileSync("tar", ["-tzf", gz], { encoding: "utf8" }).trim().split("\n")
    expect(listed).toEqual(["database/products.csv"])
  })

  it("长路径按 ustar 前缀拆开，系统 tar 也能正确认出来", async () => {
    const dir = await workdir()
    const long = "uploads/product-images/11111111-2222-3333-4444-555555555555/2026-10-22-abcdefghijklmnopqrstuvwxyzabcdefghijklmn.png"
    expect(Buffer.byteLength(long)).toBeGreaterThan(100)
    expect(splitTarName(long)?.prefix).toBeTruthy()

    const source = join(dir, "a.bin")
    await writeFile(source, "hello")
    const archive = await collect([{ name: long, path: source, size: 5 }])
    const gz = join(dir, "long.tar.gz")
    await writeFile(gz, gzipSync(archive))

    expect(execFileSync("tar", ["-tzf", gz], { encoding: "utf8" }).trim()).toBe(long)
    expect(readTarEntries(archive)[0]).toMatchObject({ name: long })
    expect(readTarEntries(archive)[0].content.toString()).toBe("hello")
  })

  it("连前缀也放不下的超长名字改用 GNU 长名条目，系统 tar 照样认得", async () => {
    const dir = await workdir()
    const veryLong = `${"a/".repeat(80)}${"b".repeat(90)}`
    const singleSegment = `${"x".repeat(200)}.png`
    expect(splitTarName(veryLong)).not.toBeNull()
    expect(splitTarName(singleSegment)).toBeNull()

    const source = join(dir, "b.bin")
    await writeFile(source, "world")
    const archive = await collect([{ name: singleSegment, path: source, size: 5 }])
    const gz = join(dir, "gnu-long.tar.gz")
    await writeFile(gz, gzipSync(archive))

    expect(execFileSync("tar", ["-tzf", gz], { encoding: "utf8" }).trim()).toBe(singleSegment)
    expect(readTarEntries(archive)[0]).toMatchObject({ name: singleSegment })
    expect(readTarEntries(archive)[0].content.toString()).toBe("world")
  })

  it("内容原样读回来，多字节内容不串", async () => {
    const dir = await workdir()
    const text = "sku,name\nA-1,三键开关（白色）\n"
    const source = join(dir, "b.csv")
    await writeFile(source, text, "utf8")
    const size = Buffer.byteLength(text)

    const entries = readTarEntries(await collect([{ name: "database/products.csv", path: source, size }]))
    expect(entries).toHaveLength(1)
    expect(entries[0].content.toString("utf8")).toBe(text)
  })

  it("读取时拦住绝对路径与上跳路径", () => {
    expect(isSafeArchiveName("database/products.csv")).toBe(true)
    expect(isSafeArchiveName("/etc/passwd")).toBe(false)
    expect(isSafeArchiveName("../../etc/passwd")).toBe(false)
    expect(isSafeArchiveName("a/./b")).toBe(false)
    expect(isSafeArchiveName("a\\b")).toBe(false)

    const header = tarHeader("../evil.txt", 0)
    expect(() => readTarEntries(Buffer.concat([header, Buffer.alloc(1024)]))).toThrow(/不安全/)
  })

  it("校验和写对了：系统 tar 不报 header checksum 错误", async () => {
    const dir = await workdir()
    const source = join(dir, "c.txt")
    await writeFile(source, "x")
    const archive = await collect([{ name: "c.txt", path: source, size: 1 }])
    const gz = join(dir, "c.tar.gz")
    await writeFile(gz, gzipSync(archive))

    const output = execFileSync("tar", ["-tvzf", gz], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    expect(output).toContain("c.txt")
  })
})
