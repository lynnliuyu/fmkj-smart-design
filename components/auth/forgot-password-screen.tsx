"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"

type Step = "enter-target" | "enter-code"

export function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>("enter-target")
  const [target, setTarget] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string>("")
  const [success, setSuccess] = useState(false)

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  const isPhone = /^1[3-9]\d{9}$/.test(target)
  const targetValid = isEmail || isPhone
  const targetLabel = isEmail ? "邮箱" : isPhone ? "手机号" : "邮箱或手机号"

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

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
        body: JSON.stringify({ target: target.trim(), type: "reset-password" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "发送失败")
        return
      }
      setCooldown(60)
      setStep("enter-code")
      toast.success(`验证码已发送到您的${targetLabel}`)
      if (data.code) {
        toast.info(`[开发模式] 验证码: ${data.code}`, { duration: 10000 })
      }
    } catch {
      setError("网络错误，请重试")
    }
  }, [target, targetValid, targetLabel])

  const handleResetPassword = useCallback(async () => {
    if (code.length !== 6) {
      setError("请输入6位验证码")
      return
    }
    if (newPassword.length < 6) {
      setError("密码至少6位")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          code,
          newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "重置失败")
        setLoading(false)
        return
      }
      setSuccess(true)
      toast.success("密码已重置，请使用新密码登录")
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }, [target, code, newPassword])

  return (
    <section className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <span className="text-xl font-medium">FMKJ</span>
        </div>

        {success ? (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Check className="size-4 text-success" />
                密码已重置
              </CardTitle>
              <CardDescription>
                请使用新密码登录您的账号。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => (window.location.href = "/login")}>
                返回登录
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="text-center">
              <CardTitle>找回密码</CardTitle>
              <CardDescription>
                {step === "enter-target"
                  ? "输入注册邮箱或手机号，我们会发送验证码给你。"
                  : `验证码已发送到 ${target}，请输入验证码和新密码。`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive-strong">
                  {error}
                </div>
              )}

              {step === "enter-target" ? (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reset-target">{targetLabel}</Label>
                    <Input
                      id="reset-target"
                      type="text"
                      placeholder="手机号或邮箱"
                      value={target}
                      onChange={(e) => {
                        setTarget(e.target.value)
                        setError("")
                      }}
                      autoComplete="tel email"
                    />
                  </div>
                  <Button type="button" disabled={!targetValid} onClick={handleSendCode}>
                    发送验证码
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>验证码</Label>
                    <InputOTP maxLength={6} value={code} onChange={setCode}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={cooldown > 0}
                    onClick={handleSendCode}
                  >
                    {cooldown > 0 ? `重新发送 (${cooldown}s)` : "重新发送验证码"}
                  </Button>

                  <div className="grid gap-2">
                    <Label htmlFor="new-password">新密码</Label>
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="至少6位"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value)
                        setError("")
                      }}
                      autoComplete="new-password"
                    />
                  </div>

                  <Button
                    type="button"
                    disabled={code.length !== 6 || newPassword.length < 6 || loading}
                    onClick={handleResetPassword}
                  >
                    {loading ? "重置中..." : "重置密码"}
                  </Button>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <a
                href="/login"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <ArrowLeft className="size-4" />
                返回登录
              </a>
            </CardFooter>
          </Card>
        )}
      </div>
    </section>
  )
}
