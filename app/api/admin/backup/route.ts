import { createGzip } from "node:zlib"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { tarStream } from "@/lib/backup-archive"
import { BackupRestoreError, MAX_RESTORE_BYTES, prepareBackup, restoreBackup } from "@/lib/backup-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 备份包可能上百 MB，不能被默认的响应缓冲掐掉。
export const maxDuration = 300

function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  return `fmkj-backup-${stamp}.tar.gz`
}

/**
 * 导出备份：整库 + 上传的附件，流式下载。
 *
 * 边打边发，不把整份备份读进内存；下载结束后删掉服务端的临时文件。
 */
export async function GET() {
  let prepared
  try {
    await requireSuperAdmin()
    prepared = await prepareBackup()
  } catch (error) {
    return adminApiErrorResponse(error)
  }

  const gzip = createGzip()
  Readable.from(tarStream(prepared.files)).pipe(gzip)
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    void prepared.cleanup()
  }
  gzip.on("end", cleanup)
  gzip.on("error", cleanup)
  gzip.on("close", cleanup)

  return new NextResponse(Readable.toWeb(gzip) as ReadableStream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${backupFileName()}"`,
      "Content-Type": "application/gzip",
      "X-Backup-Tables": String(prepared.manifest.tables.length),
      "X-Backup-Bytes": String(prepared.totalBytes),
    },
  })
}

/**
 * 从备份包恢复。请求体就是备份包本身（不是表单），这样不用为了解析表单再复制一份到内存。
 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin()

    const declared = Number(request.headers.get("content-length") ?? 0)
    if (declared > MAX_RESTORE_BYTES) {
      return NextResponse.json(
        { error: "BACKUP_TOO_LARGE", message: `备份包超过 ${Math.round(MAX_RESTORE_BYTES / 1024 / 1024)}MB，请用设备上的宿主机恢复步骤` },
        { status: 413 },
      )
    }

    const archive = Buffer.from(await request.arrayBuffer())
    if (!archive.byteLength) {
      return NextResponse.json({ error: "BACKUP_EMPTY", message: "没有收到备份文件内容" }, { status: 400 })
    }

    return NextResponse.json({ result: await restoreBackup(archive) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof BackupRestoreError) {
      return NextResponse.json({ error: "RESTORE_FAILED", message: error.message }, { status: error.status })
    }
    return adminApiErrorResponse(error)
  }
}
