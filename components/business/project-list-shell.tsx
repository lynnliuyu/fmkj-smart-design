"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** 项目 / 报价 / 合同三个列表页共用的页头：标题 + 右侧操作区。 */
export function ProjectListHeader({
  actions,
  title,
}: {
  actions?: React.ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {actions}
    </div>
  )
}

/** 列表页统一的搜索输入；三页只是 placeholder 与宽度不同。 */
export function ProjectSearchInput({
  onChange,
  placeholder,
  size = "sm",
  value,
}: {
  onChange: (value: string) => void
  placeholder: string
  size?: "sm" | "md"
  value: string
}) {
  return (
    <div className={cn("relative w-full", size === "md" ? "lg:max-w-md" : "lg:max-w-sm")}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 pl-9"
      />
    </div>
  )
}
