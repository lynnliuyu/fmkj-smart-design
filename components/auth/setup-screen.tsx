"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * 全新设备的首次初始化：客户自己设管理员账号。
 *
 * 装机脚本不建管理员、也不代客户设密码——设备到手后第一次打开页面，就在这里填。
 * 设置完成后直接登录并进入工作台，不需要再输一次。
 */
export function SetupScreen() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError("")
    if (password !== confirm) {
      setError("两次输入的密码不一样")
      return
    }
    setBusy(true)
    try {
      const response = await fetch("/api/setup", {
        body: JSON.stringify({ email, name, password }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string; next?: string }
      if (!response.ok) {
        setError(payload.message ?? "设置失败，请重试")
        return
      }
      router.replace(payload.next ?? "/projects")
      router.refresh()
    } catch {
      setError("连不上服务，请稍后重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5" />
            第一次使用，先设置管理员账号
          </CardTitle>
          <CardDescription>
            这台设备还没有管理员。填好下面的信息就能开始用；这个账号可以管理全部数据和设置，请自己保管好密码。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="setup-name">你的名字</Label>
            <Input id="setup-name" onChange={(event) => setName(event.target.value)} placeholder="例如：王师傅" value={name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-email">登录邮箱</Label>
            <Input
              autoComplete="username"
              id="setup-email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              value={email}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-password">密码</Label>
            <Input
              autoComplete="new-password"
              id="setup-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位，要有字母和数字"
              type="password"
              value={password}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-confirm">再输一次密码</Label>
            <Input
              autoComplete="new-password"
              id="setup-confirm"
              onChange={(event) => setConfirm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
              type="password"
              value={confirm}
            />
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {busy ? "正在设置…" : "设置完成，开始使用"}
          </Button>
          <p className="text-xs text-muted-foreground">
            忘了密码没关系：设备上有备份，也可以用管理员邮箱重置。碰到问题请联系给你装设备的人。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
