import type * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export function SummaryTile({
  className,
  detail,
  icon: Icon,
  label,
  value,
}: {
  className?: string
  detail?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
}) {
  return (
    <div className={cn("rounded-lg border bg-muted/20 p-3", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
      {detail ? <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

export function SummaryField({
  className,
  label,
  value,
  wide = false,
}: {
  className?: string
  label: string
  value: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn(wide && "md:col-span-2", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 rounded-lg border bg-muted/20 px-3 py-2 text-sm">{value}</div>
    </div>
  )
}

/** 列表页顶部的一行紧凑统计，替代四张独立卡片。 */
export function StatStrip({
  className,
  items,
}: {
  className?: string
  items: Array<{
    label: string
    value: React.ReactNode
    tone?: "default" | "warn"
    /** 可选：统计项本身就是入口时给出目标地址，整块可点。 */
    href?: string
  }>
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 text-sm", className)}>
      {items.map((item) => {
        const body = (
          <>
            {item.label}{" "}
            <span
              className={cn(
                "font-semibold tabular-nums text-foreground",
                item.tone === "warn" && "text-destructive"
              )}
            >
              {item.value}
            </span>
          </>
        )

        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {body}
          </Link>
        ) : (
          <span key={item.label} className="text-muted-foreground">
            {body}
          </span>
        )
      })}
    </div>
  )
}
