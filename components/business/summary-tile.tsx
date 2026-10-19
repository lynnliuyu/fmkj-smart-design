import type * as React from "react"

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
