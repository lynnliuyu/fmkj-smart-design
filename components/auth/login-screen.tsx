"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  MessageCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"

type LoginMode = "password" | "sms"

export function LoginScreen({
  redirectTo = "/projects",
}: {
  redirectTo?: string
}) {
  const [mode, setMode] = useState<LoginMode>("password")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const [target, setTarget] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  const isPhone = /^1[3-9]\d{9}$/.test(target)
  const targetValid = isEmail || isPhone
  const targetLabel = isPhone ? "手机号" : isEmail ? "邮箱" : "邮箱或手机号"

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function resetState(nextMode: LoginMode) {
    setMode(nextMode)
    setError("")
    setLoading(false)
  }

  const completeLogin = useCallback(() => {
    window.setTimeout(() => setLoading(false), 1500)
    window.location.assign(redirectTo)
  }, [redirectTo])

  const handleSendCode = useCallback(async () => {
    if (!targetValid) {
      setError("请输入有效的邮箱或手机号")
      return
    }

    setError("")

    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), type: "login" }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "验证码发送失败")
        return
      }

      setCodeSent(true)
      setCooldown(60)
      toast.success(`验证码已发送到您的${targetLabel}`)

      if (data.code) {
        toast.info(`开发模式验证码：${data.code}`, { duration: 10000 })
      }
    } catch {
      setError("网络错误，请稍后重试")
    }
  }, [target, targetValid, targetLabel])

  const handleCodeLogin = useCallback(async () => {
    if (!targetValid) {
      setError("请输入有效的邮箱或手机号")
      return
    }

    if (code.length !== 6) {
      setError("请输入 6 位验证码")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "code", target: target.trim(), code }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "登录失败")
        setLoading(false)
        return
      }

      completeLogin()
    } catch {
      setError("网络错误，请稍后重试")
      setLoading(false)
    }
  }, [target, targetValid, code, completeLogin])

  const handlePasswordLogin = useCallback(async () => {
    if (!email.trim() || !password) {
      setError("请输入邮箱和密码")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "password", email: email.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "登录失败")
        setLoading(false)
        return
      }

      completeLogin()
    } catch {
      setError("网络错误，请稍后重试")
      setLoading(false)
    }
  }, [email, password, completeLogin])

  return (
    <section className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r bg-muted/40 lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:42px_42px] opacity-40" />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-12">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="font-semibold leading-none">FMKJ</p>
              <p className="mt-1 text-xs text-muted-foreground">项目运营后台</p>
            </div>
          </div>

          <div className="max-w-xl space-y-5">
            <p className="text-3xl font-semibold tracking-normal">
              项目、产品、报价和交付记录统一管理
            </p>
            <p className="text-base leading-7 text-muted-foreground">
              登录后可以查看项目流程、产品库、方案报价、附件和团队权限。
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="size-5" />
              </div>
              <span className="text-lg font-semibold">FMKJ</span>
            </div>
          </div>

          {mode === "password" ? (
            <div className="space-y-6">
              <AuthHeader title="登录您的账号" description="输入邮箱和密码进入项目运营后台" />

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handlePasswordLogin()
                }}
              >
                <FieldError message={error} />

                <div className="grid gap-2">
                  <Label htmlFor="email">邮箱</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      className="h-10 pl-9"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        setError("")
                      }}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">密码</Label>
                    <Link
                      href="/forgot-password"
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      忘记密码？
                    </Link>
                  </div>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      className="h-10 pl-9"
                      type="password"
                      placeholder="输入密码"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setError("")
                      }}
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                <Button type="submit" className="h-10 w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      登录中
                    </>
                  ) : (
                    <>
                      <LogIn className="size-4" />
                      登录
                    </>
                  )}
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">其他登录方式</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button type="button" variant="outline" className="h-10" onClick={() => resetState("sms")}>
                  <Smartphone className="size-4" />
                  短信
                </Button>
                <Button type="button" variant="outline" className="h-10" disabled>
                  <MessageCircle className="size-4" />
                  微信
                </Button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                没有账号？{" "}
                <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
                  注册
                </Link>
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <Button
                type="button"
                variant="ghost"
                className="-ml-2 h-8 px-2 text-muted-foreground"
                onClick={() => resetState("password")}
              >
                <ArrowLeft className="size-4" />
                返回密码登录
              </Button>

              <AuthHeader title="短信验证码登录" description="输入手机号或邮箱，获取 6 位验证码" />

              <div className="space-y-4">
                <FieldError message={error} />

                <div className="grid gap-2">
                  <Label htmlFor="target">{targetLabel}</Label>
                  <Input
                    id="target"
                    className="h-10"
                    type="text"
                    placeholder="手机号或邮箱"
                    value={target}
                    onChange={(event) => {
                      setTarget(event.target.value)
                      setCodeSent(false)
                      setCode("")
                      setError("")
                    }}
                    autoComplete="tel email"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full"
                  disabled={!targetValid || cooldown > 0}
                  onClick={handleSendCode}
                >
                  {cooldown > 0
                    ? `重新发送 ${cooldown}s`
                    : codeSent
                      ? "重新发送验证码"
                      : "发送验证码"}
                  {codeSent && <CheckCircle2 className="size-4 text-emerald-600" />}
                </Button>

                <div className={cn("grid gap-2", !codeSent && "opacity-50")}>
                  <Label>验证码</Label>
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={(value) => {
                      setCode(value)
                      setError("")
                    }}
                    disabled={!codeSent}
                  >
                    <InputOTPGroup className="w-full justify-between">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot key={index} index={index} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <Button
                  type="button"
                  className="h-10 w-full"
                  disabled={!codeSent || code.length !== 6 || loading}
                  onClick={handleCodeLogin}
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      登录中
                    </>
                  ) : (
                    "登录"
                  )}
                </Button>
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            登录即代表您确认当前操作符合公司项目管理和客户资料使用规范。
          </p>
        </div>
      </div>
    </section>
  )
}

function AuthHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  if (!message) return null

  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
