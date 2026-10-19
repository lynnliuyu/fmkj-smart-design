"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  UserRound,
  UserRoundPlus,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SignUpScreen({
  redirectTo = "/projects",
}: {
  redirectTo?: string
}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleRegister = useCallback(async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError("请填写姓名、邮箱和密码")
      return
    }

    if (password.length < 8) {
      setError("密码至少需要 8 位")
      return
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致")
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "注册失败")
        setLoading(false)
        return
      }

      router.push(redirectTo)
    } catch {
      setError("网络错误，请稍后重试")
      setLoading(false)
    }
  }, [name, email, password, confirmPassword, router, redirectTo])

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
              创建账户后即可管理项目、产品库和报价流程
            </p>
            <p className="text-base leading-7 text-muted-foreground">
              新成员账号创建后，可以在团队权限中调整为销售、工程师或经理-老板。
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

          <div className="space-y-6">
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-semibold tracking-normal">创建账户</h1>
              <p className="text-sm text-muted-foreground">
                填写基础信息，注册后自动进入项目后台。
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleRegister()
              }}
            >
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <AuthInput
                autoComplete="name"
                icon={UserRound}
                id="name"
                label="姓名"
                onChange={(value) => {
                  setName(value)
                  setError("")
                }}
                placeholder="输入姓名"
                value={name}
              />
              <AuthInput
                autoComplete="email"
                icon={Mail}
                id="email"
                label="邮箱"
                onChange={(value) => {
                  setEmail(value)
                  setError("")
                }}
                placeholder="name@example.com"
                type="email"
                value={email}
              />
              <AuthInput
                autoComplete="new-password"
                icon={KeyRound}
                id="password"
                label="密码"
                onChange={(value) => {
                  setPassword(value)
                  setError("")
                }}
                placeholder="至少 8 位"
                type="password"
                value={password}
              />
              <AuthInput
                autoComplete="new-password"
                icon={KeyRound}
                id="confirmPassword"
                label="确认密码"
                onChange={(value) => {
                  setConfirmPassword(value)
                  setError("")
                }}
                placeholder="再次输入密码"
                type="password"
                value={confirmPassword}
              />

              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    注册中
                  </>
                ) : (
                  <>
                    <UserRoundPlus className="size-4" />
                    注册
                  </>
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  其他注册方式
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="h-10" disabled>
                <Smartphone className="size-4" />
                短信
              </Button>
              <Button type="button" variant="outline" className="h-10" disabled>
                <MessageCircle className="size-4" />
                微信
              </Button>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              已有账户？{" "}
              <Link
                href="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                返回登录
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function AuthInput({
  autoComplete,
  icon: Icon,
  id,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  autoComplete: string
  icon: typeof UserRound
  id: string
  label: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          className="h-10 pl-9"
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
        />
      </div>
    </div>
  )
}
