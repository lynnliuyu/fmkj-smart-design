"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { UpdateStatus } from "@/lib/deploy-update"

const POLL_MS = 3000
const POLL_LIMIT_MS = 10 * 60 * 1000

/**
 * 在线更新：客户在这里点两下就完成升级。
 *
 * 页面本身装不了软件——应用被关在隔离的容器里，故意不给它设备底层权限（ADR 0010）。
 * 这里只把「想装哪个版本」写成一条请求，设备上的更新管家看到后代跑：备份 → 拉镜像 →
 * 升级数据库 → 切换 → 自检。进度与失败原因由管家写回来，这个面板负责显示。
 */
export function UpdatePanel({ initial }: { initial?: UpdateStatus | null } = {}) {
  const [state, setState] = useState<UpdateStatus | null>(initial ?? null)
  const [busy, setBusy] = useState<"" | "check" | "update">("")
  const [message, setMessage] = useState("")
  const pollUntil = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/system/update", { cache: "no-store" })
      if (!response.ok) return
      setState((await response.json()) as UpdateStatus)
    } catch {
      // 更新过程中应用容器会被替换，这一两分钟请求失败是正常的：下一轮再试。
    }
  }, [])

  // 首屏数据由服务端渲染直接给出（页面打开就看得见）；这里只在点了按钮之后轮询进度。
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < pollUntil.current) void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  async function act(action: "check" | "update", to?: string) {
    setBusy(action)
    setMessage("")
    try {
      const response = await fetch("/api/admin/system/update", {
        body: JSON.stringify(action === "update" ? { action, to } : { action }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
      setMessage(payload.message ?? payload.error ?? "")
      if (response.ok) {
        pollUntil.current = Date.now() + POLL_LIMIT_MS
        void refresh()
      }
    } catch {
      setMessage("请求发不出去：应用可能正在重启（更新中），等一分钟再刷新这个页面。")
    } finally {
      setBusy("")
    }
  }

  const check = state?.check ?? null
  const target = check?.latestVersion ?? ""
  // 两个条件都要满足：检查结果说有新版本，而且那个版本不是正在跑的这个。
  // 只看检查结果会在「刚更新完、检查结果还没刷新」时催客户再装一遍。
  const upToDate = Boolean(target) && target === state?.currentVersion
  const canUpdate = Boolean(check?.updateAvailable && target && !upToDate && !state?.progress.busy)

  return (
    <Card>
      <CardHeader>
        <CardTitle>在线更新</CardTitle>
        <CardDescription>
          点一下就能升级到新版本：设备会先自动备份，再升级数据库并切换版本，最后自检。
          整个过程约一两分钟，这期间页面会打不开——不要断电、不要拔网线。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy !== "" || state?.progress.busy} onClick={() => void act("check")} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            {busy === "check" ? "正在检查…" : "检查有没有新版本"}
          </Button>
          <Button disabled={!canUpdate || busy !== ""} onClick={() => void act("update", target)}>
            <UploadCloud className="mr-2 h-4 w-4" />
            {busy === "update" ? "正在请求…" : canUpdate ? `立即更新到 ${target}` : "已经是最新版本"}
          </Button>
          {check?.checkedAt ? (
            <span className="text-muted-foreground">
              上次检查：{new Date(check.checkedAt).toLocaleString("zh-CN", { hour12: false })}
              {check.signature === "verified" ? "（版本清单已验签）" : ""}
            </span>
          ) : null}
        </div>

        <div
          className={
            state?.progress.tone === "error"
              ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive"
              : state?.progress.tone === "ok"
                ? "rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900"
                : state?.progress.tone === "warn"
                  ? "rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
                  : "rounded-md border bg-muted/40 p-3"
          }
        >
          {state?.progress.message ?? "正在读取更新状态…"}
          {state?.currentVersion ? <span className="text-muted-foreground">（当前版本 {state.currentVersion}）</span> : null}
        </div>

        {message ? <div className="text-muted-foreground">{message}</div> : null}

        {check?.error ? (
          <div className="text-destructive">
            上次检查失败：{check.error}
            <span className="text-muted-foreground">
              （多半是设备连不上发布服务器；不影响现在使用，也不影响业务数据。）
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
