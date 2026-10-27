"use client"

import { useRef, useState } from "react"
import { Download, FileSpreadsheet, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ImportAction, ImportChange } from "@/lib/product-import"

export type PreviewRow = {
  action: ImportAction
  changes: ImportChange[]
  line: number
  message: string
  name: string
  sku: string
}

export type Preview = {
  fileError: string | null
  rows: PreviewRow[]
  summary: { create: number; error: number; total: number; unchanged: number; update: number }
  unknownHeaders: string[]
}

type ApplyResult = {
  created: number
  failed: number
  fileError: string | null
  rows: Array<{ line: number; message: string; name: string; sku: string; status: "created" | "updated" | "failed" | "skipped" }>
  skipped: number
  updated: number
}

const PREVIEW_ROWS_SHOWN = 200

const actionLabels: Record<ImportAction, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
  create: { label: "新增", variant: "default" },
  error: { label: "有问题", variant: "destructive" },
  unchanged: { label: "不变", variant: "outline" },
  update: { label: "覆盖", variant: "secondary" },
}

/**
 * 批量导入产品库：下载模板 → 选文件 → 先预演 → 确认才写库。
 * 预演那一屏是刻意的：客户的表格总有错行，先看清「会覆盖哪些字段」比事后回滚便宜。
 */
export function ProductImportDialog({ onImported }: { onImported: () => Promise<boolean> | void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [csv, setCsv] = useState("")
  const [fileName, setFileName] = useState("")
  const [message, setMessage] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setBusy(false)
    setCsv("")
    setFileName("")
    setMessage("")
    setPreview(null)
    setResult(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function pickFile(file: File | null) {
    if (!file) return
    setMessage("")
    setPreview(null)
    setResult(null)
    const text = await file.text()
    setCsv(text)
    setFileName(file.name)
    if (text.includes("\uFFFD")) {
      setMessage("这个文件的编码不是 UTF-8，中文会变成乱码。请在 Excel 里选「另存为 → CSV UTF-8」再上传。")
    }
  }

  async function post(mode: "preview" | "apply") {
    setBusy(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/products/import", {
        body: JSON.stringify({ csv, mode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(String(data?.message ?? data?.error ?? "导入失败"))
      if (mode === "preview") setPreview(data.preview as Preview)
      else {
        const applied = data.result as ApplyResult
        setResult(applied)
        setPreview(null)
        await onImported()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败")
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(preview?.fileError)
  const actionable = preview ? preview.summary.create + preview.summary.update : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload />
          批量导入
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>批量导入产品</DialogTitle>
          <DialogDescription>
            用系统货号认人：没有的建新的，已有的只覆盖你填了的列。空着的格子表示&ldquo;这一项不改&rdquo;，
            想清空请到产品里单独修改。导入的新产品是&ldquo;待审核&rdquo;状态，和手工新建一样。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a download href="/api/admin/products/import/template">
                <Download />
                下载模板
              </a>
            </Button>
            <input
              ref={fileRef}
              accept=".csv,text/csv"
              className="hidden"
              type="file"
              onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet />
              选择 CSV 文件
            </Button>
            {fileName ? <span className="text-sm text-muted-foreground">已选：{fileName}</span> : null}
          </div>

          <p className="text-sm text-muted-foreground">
            模板是 CSV（逗号分隔）。用 Excel 打开填好后，请选&ldquo;另存为 → CSV UTF-8&rdquo;，否则中文会乱码。
            多个标签或渠道写在一个格子里，用分号隔开，例如&ldquo;开关;白色&rdquo;。
          </p>

          <div className="flex gap-2">
            <Button disabled={busy || !csv} onClick={() => void post("preview")}>
              先预演一遍
            </Button>
            <Button disabled={busy || !preview || blocked || actionable === 0} onClick={() => void post("apply")}>
              确认导入（{actionable} 行）
            </Button>
          </div>

          {message ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{message}</p> : null}

          {preview?.fileError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{preview.fileError}</p>
          ) : null}

          {preview && !preview.fileError ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="default">新增 {preview.summary.create}</Badge>
                <Badge variant="secondary">覆盖 {preview.summary.update}</Badge>
                <Badge variant="outline">不变 {preview.summary.unchanged}</Badge>
                <Badge variant={preview.summary.error ? "destructive" : "outline"}>有问题 {preview.summary.error}</Badge>
                <span className="text-muted-foreground">共 {preview.summary.total} 行</span>
              </div>
              {preview.unknownHeaders.length ? (
                <p className="text-sm text-muted-foreground">
                  这些列名不认识，已忽略：{preview.unknownHeaders.join("、")}
                </p>
              ) : null}
              <PreviewTable rows={preview.rows} />
            </div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                导入结束：新增 {result.created}、更新 {result.updated}、跳过 {result.skipped}、失败 {result.failed}。
                {result.created ? "新增的产品在列表里是待审核状态，可以批量批准。" : ""}
              </p>
              {result.rows.some((row) => row.status === "failed") ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>行</TableHead>
                      <TableHead>系统货号</TableHead>
                      <TableHead>失败原因</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.filter((row) => row.status === "failed").map((row) => (
                      <TableRow key={`${row.line}-${row.sku}`}>
                        <TableCell>{row.line}</TableCell>
                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                        <TableCell>{row.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const shown = rows.slice(0, PREVIEW_ROWS_SHOWN)

  return (
    <div className="flex flex-col gap-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>行</TableHead>
            <TableHead>系统货号</TableHead>
            <TableHead>产品名称</TableHead>
            <TableHead>处理</TableHead>
            <TableHead>说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={`${row.line}-${row.sku}`}>
              <TableCell>{row.line}</TableCell>
              <TableCell className="font-mono text-xs">{row.sku}</TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>
                <Badge variant={actionLabels[row.action].variant}>{actionLabels[row.action].label}</Badge>
              </TableCell>
              <TableCell className="text-sm">
                {row.action === "error" || !row.changes.length
                  ? row.message
                  : row.changes.map((change) => `${change.label}：${change.from || "空"} → ${change.to}`).join("；")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown.length ? (
        <p className="text-sm text-muted-foreground">只显示前 {PREVIEW_ROWS_SHOWN} 行，实际会处理全部 {rows.length} 行。</p>
      ) : null}
    </div>
  )
}
