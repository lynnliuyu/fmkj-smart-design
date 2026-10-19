import type { ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type PlatformListCardProps = {
  actions?: ReactNode
  children: ReactNode
  title: string
}

export function PlatformListCard({ actions, children, title }: PlatformListCardProps) {
  return (
    <Card className="gap-0 overflow-hidden rounded-lg py-0">
      <CardHeader className="flex-row items-center justify-between border-b px-4 py-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}

export function PlatformRowActions({
  children,
  label = "打开操作菜单",
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PlatformRowActionItem({
  asChild,
  children,
  onClick,
}: {
  asChild?: boolean
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <DropdownMenuItem asChild={asChild} onClick={onClick}>
      {children}
    </DropdownMenuItem>
  )
}
