"use client"

import {
  ArrowLeft,
  Home,
  LockKeyhole,
  SearchX,
  ServerCrash,
  ShieldAlert,
  Wrench,
} from "lucide-react"

import { Button } from "@/components/ui/button"

type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "internal-server-error"
  | "maintenance-error"

type ErrorStateConfig = {
  code: string
  title: string
  description: string
  detail: string
  icon: typeof LockKeyhole
  primaryLabel: string
}

const errorStates: Record<ErrorKind, ErrorStateConfig> = {
  unauthorized: {
    code: "401",
    title: "未授权访问",
    description: "请先登录正确的团队账号，再访问这个资源。",
    detail: "如果你已经登录，可能是当前会话已过期，请重新登录后再试。",
    icon: LockKeyhole,
    primaryLabel: "去登录",
  },
  forbidden: {
    code: "403",
    title: "无权限访问",
    description: "你的角色没有查看此页面或执行此操作的权限。",
    detail: "可以联系经理-老板调整角色权限，或切换到有权限的团队账号。",
    icon: ShieldAlert,
    primaryLabel: "查看团队权限",
  },
  "not-found": {
    code: "404",
    title: "页面不存在",
    description: "你访问的页面不存在，或者已经被移动、删除。",
    detail: "请检查地址是否正确，也可以返回工作台继续操作。",
    icon: SearchX,
    primaryLabel: "返回首页",
  },
  "internal-server-error": {
    code: "500",
    title: "服务器开小差了",
    description: "系统处理请求时遇到了异常，请稍后再试。",
    detail: "如果问题持续出现，请记录当前操作路径并联系技术支持。",
    icon: ServerCrash,
    primaryLabel: "返回首页",
  },
  "maintenance-error": {
    code: "503",
    title: "系统维护中",
    description: "当前服务正在维护或升级，暂时无法访问。",
    detail: "维护完成后会自动恢复，你可以稍后刷新页面再试。",
    icon: Wrench,
    primaryLabel: "了解维护状态",
  },
}

export function ErrorState({ kind }: { kind: ErrorKind }) {
  const state = errorStates[kind]
  const Icon = state.icon

  function goBack() {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = "/"
    }
  }

  function goPrimary() {
    if (kind === "unauthorized") {
      window.location.href = "/login"
      return
    }

    if (kind === "forbidden") {
      window.location.href = "/settings/account"
      return
    }

    window.location.href = "/"
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
        <div className="mb-8 flex size-16 items-center justify-center rounded-lg border bg-muted">
          <Icon className="size-8 text-muted-foreground" />
        </div>
        <div className="text-[88px] font-bold leading-none tracking-tight text-foreground sm:text-[112px]">
          {state.code}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {state.title}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          {state.description}
          <br />
          {state.detail}
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={goBack}>
            <ArrowLeft className="size-4" />
            返回上一页
          </Button>
          <Button onClick={goPrimary}>
            <Home className="size-4" />
            {state.primaryLabel}
          </Button>
        </div>
      </section>
    </main>
  )
}
