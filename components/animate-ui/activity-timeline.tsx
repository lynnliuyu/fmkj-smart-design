"use client"

import { Badge } from "@/components/ui/badge"
import { type ActivityFeedItem, activityIconMap } from "@/lib/activity-feed"
import { cn } from "@/lib/utils"

export function ActivityTimeline({
  className,
  emptyText = "暂无活动记录",
  items,
}: {
  className?: string
  emptyText?: string
  items: ActivityFeedItem[]
}) {
  if (items.length === 0) {
    return <div className={cn("rounded-lg border p-6 text-center text-sm text-muted-foreground", className)}>{emptyText}</div>
  }

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item) => {
        const Icon = activityIconMap[item.iconKey]

        return (
          <div className="grid grid-cols-[36px_1fr] gap-3 rounded-lg border p-3" key={item.id}>
            <div className={cn("flex size-9 items-center justify-center rounded-md border", item.tone)}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">{item.title}</div>
                <Badge variant="outline" className="h-6 whitespace-nowrap">
                  {item.time}
                </Badge>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>操作人：{item.actor}</span>
                <span>对象：{item.subject}</span>
                {item.duration ? <span>耗时：{item.duration}</span> : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
