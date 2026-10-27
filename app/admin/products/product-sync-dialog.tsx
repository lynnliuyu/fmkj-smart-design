"use client"

import { useEffect, useState } from "react"
import { CloudDownload, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format-datetime"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { PreviewTable, type Preview } from "@/app/admin/products/product-import-dialog"

type SyncStatus = {
  baseUrl: string
  configured: boolean
  enabled: boolean
  lastRun: {
    created: number
    signature: string
    failed: number
    finishedAt: string | null
    message: string
    revision: string
    skipped: number
    startedAt: string
    status: string
    updated: number
  } | null
}

type SyncPreview = {
  message: string
  preview: Preview | null
  revision: string
}

/**
 * 从运营方服务器同步官方产品资料。
 *
 * 和批量导入同一条规矩：先拉下来预演（会覆盖哪几项写得清清楚楚），管理员确认才写库。
 * 连不上或凭据过期时什么都不改，本地资料继续可用。
 */
export function ProductSyncDialog({ onImported }: { onImported: () => Promise<boolean> | void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [message, setMessage] = useState("")
  const [done, setDone] = useState<string>("")
  const [updateExisting, setUpdateExisting] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const response = await fetch("/api/admin/catalog/sync", { cache: "no-store" })
        const data = await response.json()
        if (response.ok) setStatus(data.status as SyncStatus)
      } catch {
        setStatus(null)
      }
    })()
  }, [open])

  async function post(mode: "preview" | "apply") {
    setBusy(true)
    setMessage("")
    setDone("")
    try {
      const response = await fetch("/api/admin/catalog/sync", {
        body: JSON.stringify({ mode, updateExisting }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(String(data?.message ?? data?.error ?? "同步失败"))
      if (mode === "preview") {
        setPreview(data.preview as SyncPreview)
      } else {
        const result = data.result
        setPreview(null)
        setDone(result
          ? `同步完成：新增 ${result.created}、更新 ${result.updated}、不变 ${result.skipped}、失败 ${result.failed}。`
          : "没有可应用的内容。")
        await onImported()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败")
    } finally {
      setBusy(false)
    }
  }

  const actionable = preview?.preview ? preview.preview.summary.create + preview.preview.summary.update : 0

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setPreview(null); setMessage(""); setDone("") } }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CloudDownload />
          从服务器同步
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>从官方资料服务同步产品</DialogTitle>
          <DialogDescription>
            设备向官方资料服务要一份产品目录，先预演差异、你确认后才写库。连不上或凭据过期时，
            本地资料保持原样继续可用；同步不会改动客户项目、点位、报价和交付。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <StatusLine status={status} />

          <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                checked={updateExisting}
                type="checkbox"
                onChange={(event) => setUpdateExisting(event.target.checked)}
              />
              同时覆盖已有产品（默认不覆盖：只补本地没有的新品）
            </label>
            <span className="text-muted-foreground">
              不勾选时，你本地改过的价格、成本、描述都不会被官方资料动到。勾选后，官方资料里
              写了的列会覆盖本地同名产品，请先看预演结果确认。
            </span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" disabled={busy || status?.configured === false} onClick={() => void post("preview")}>
              <RefreshCw />
              检查有没有新资料
            </Button>
            <Button disabled={busy || !preview || actionable === 0} onClick={() => void post("apply")}>
              确认同步（{actionable} 行）
            </Button>
          </div>

          {message ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{message}</p> : null}
          {done ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{done}</p> : null}
          {preview?.message ? <p className="text-sm text-muted-foreground">{preview.message}</p> : null}

          {preview?.preview ? (
            preview.preview.fileError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{preview.preview.fileError}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="default">新增 {preview.preview.summary.create}</Badge>
                  <Badge variant="secondary">覆盖 {preview.preview.summary.update}</Badge>
                  <Badge variant="outline">不变 {preview.preview.summary.unchanged}</Badge>
                  <Badge variant={preview.preview.summary.error ? "destructive" : "outline"}>有问题 {preview.preview.summary.error}</Badge>
                  <span className="text-muted-foreground">
                    资料版本 {preview.revision || "未知"}，共 {preview.preview.summary.total} 行
                  </span>
                </div>
                <PreviewTable rows={preview.preview.rows} />
              </div>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusLine({ status }: { status: SyncStatus | null }) {
  if (!status) return <p className="text-sm text-muted-foreground">正在读取同步配置…</p>

  return (
    <div className="flex flex-col gap-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <div>
        {status.configured
          ? <>官方资料服务：<span className="font-mono text-xs">{status.baseUrl}</span></>
          : status.enabled
            ? "没有配置好：请补齐 UPSTREAM_BASE_URL 与 LICENSE_KEY"
            : "这台设备没有开启官方资料同步（UPSTREAM_ENABLED 未打开）"}
      </div>
      <div className="text-muted-foreground">
        {status.lastRun
          ? `上次同步：${formatMoment(status.lastRun.startedAt)}，新增 ${status.lastRun.created}、更新 ${status.lastRun.updated}、不变 ${status.lastRun.skipped}、失败 ${status.lastRun.failed}${status.lastRun.message ? `（${status.lastRun.message}）` : ""}`
          : "还没有同步记录"}
      </div>
      {status.lastRun ? (
        <div className={status.lastRun.signature === "verified" ? "text-muted-foreground" : "text-muted-foreground"}>
          {status.lastRun.signature === "verified"
            ? "资料签名：已验证（确认是官方发布）"
            : "资料签名：无（这台设备没配官方公钥，只能保证传输没被改）"}
        </div>
      ) : null}
    </div>
  )
}

function formatMoment(value: string): string {
  // 空值/非法时间原样返回；合法时间按东八区渲染，避免服务端与浏览器算出不同字符串。
  return formatDateTime(value, value)
}
