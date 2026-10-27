"use client"

import { useRef, useState } from "react"
import { AlertTriangle, DatabaseBackup, Upload } from "lucide-react"

import { formatDateTime } from "@/lib/format-datetime"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type RestoreResult = {
  appVersion: string
  createdAt: string
  rows: number
  tables: string[]
  uploads: { files: number; warning: string | null }
  warnings: string[]
}

const CONFIRM_WORD = "恢复"

/**
 * 客户自助的备份与恢复。
 *
 * 导出走浏览器直接下载（流式，不进内存）；恢复要求手工输入「恢复」两个字：
 * 这一步会把本机所有业务数据整体替换掉，不能做成点一下就执行。
 */
export function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [message, setMessage] = useState("")
  const [result, setResult] = useState<RestoreResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function restore() {
    if (!file) return
    setBusy(true)
    setMessage("")
    setResult(null)
    try {
      const response = await fetch("/api/admin/backup", {
        body: file,
        headers: { "Content-Type": "application/gzip" },
        method: "POST",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data?.message ?? data?.error ?? "恢复失败"))
      setResult(data.result as RestoreResult)
      setFile(null)
      setConfirmText("")
      if (fileRef.current) fileRef.current.value = ""
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>备份与恢复</CardTitle>
        <CardDescription>
          导出的备份包含整个业务数据库和已上传的附件，是一个普通的 .tar.gz 压缩包，
          请自己存到安全的地方（U 盘、网盘、另一台电脑都行）。需要还原时把它传回来即可。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <div className="font-medium">导出备份</div>
          <p className="text-muted-foreground">
            点了就开始下载，文件可能比较大（看附件多少），中途请不要关掉页面。
            下载下来的文件如果只有几 KB，说明登录已过期，请重新登录再试。
          </p>
          <div>
            <Button asChild variant="outline">
              <a download href="/api/admin/backup">
                <DatabaseBackup />
                导出备份并下载
              </a>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2 font-medium text-destructive-strong">
            <AlertTriangle className="size-4" />
            从备份恢复（会覆盖本机现有数据）
          </div>
          <p className="text-muted-foreground">
            恢复会把本机所有客户项目、点位、报价、产品资料和账号**整体替换**成备份里的内容，
            本机现在比备份新的修改会丢。恢复前后台会先整体校验：备份损坏、来自不兼容的版本、
            或中途出错都会整体回滚，本机数据不动。
          </p>
          <input
            ref={fileRef}
            accept=".gz,.tgz,application/gzip"
            className="text-sm"
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setMessage("")
              setResult(null)
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">确认请手动输入「{CONFIRM_WORD}」：</span>
            <Input
              className="h-8 w-28"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
            />
            <Button
              disabled={busy || !file || confirmText.trim() !== CONFIRM_WORD}
              variant="destructive"
              onClick={() => void restore()}
            >
              <Upload />
              {busy ? "正在恢复…" : "上传并恢复"}
            </Button>
          </div>
        </div>

        {message ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive-strong">{message}</p> : null}

        {result ? (
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2">
            <div className="font-medium">恢复完成</div>
            <div>
              备份时间 {formatMoment(result.createdAt)}，来自版本 {result.appVersion || "未知"}；
              已还原 {result.tables.length} 张表、约 {result.rows.toLocaleString()} 行，
              附件 {result.uploads.files} 个。
            </div>
            <div className="text-muted-foreground">
              如果页面显示异常或数据看起来不对，请重启一次应用（设备上执行 docker compose restart app）。
            </div>
            {result.warnings.length ? (
              <ul className="list-disc pl-5 text-muted-foreground">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function formatMoment(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : formatDateTime(parsed)
}
