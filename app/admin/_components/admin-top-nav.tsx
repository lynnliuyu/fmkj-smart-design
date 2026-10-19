"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const adminNavItems = [
  {
    href: "/admin",
    label: "概览",
    match: (pathname: string) => pathname === "/admin",
  },
  {
    href: "/admin/customers",
    label: "客户",
    match: (pathname: string) =>
      pathname.startsWith("/admin/customers") ||
      pathname.startsWith("/admin/organizations") ||
      pathname.startsWith("/admin/plans") ||
      pathname.startsWith("/admin/orders"),
  },
  {
    href: "/admin/products",
    label: "产品",
    match: (pathname: string) => pathname.startsWith("/admin/products"),
  },
  {
    href: "/admin/analytics",
    label: "运营",
    match: (pathname: string) =>
      pathname.startsWith("/admin/analytics") ||
      pathname.startsWith("/admin/audit-logs") ||
      pathname.startsWith("/admin/feature-flags"),
  },
  {
    href: "/admin/system",
    label: "系统",
    match: (pathname: string) =>
      pathname.startsWith("/admin/system") ||
      pathname.startsWith("/admin/environments") ||
      pathname.startsWith("/admin/database"),
  },
]

export function AdminTopNav() {
  const pathname = usePathname()

  return (
    <div className="flex min-w-0 flex-col gap-3 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">平台管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">总平台后台，仅超级管理员使用。</p>
        </div>
        <nav className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1">
          {adminNavItems.map((item) => {
            const active = item.match(pathname)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-sm px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
