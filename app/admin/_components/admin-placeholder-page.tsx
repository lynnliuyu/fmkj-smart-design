import type { LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type AdminPlaceholderPageProps = {
  title: string
  description: string
  plan: string
  icon: LucideIcon
  items: string[]
}

export function AdminPlaceholderPage({
  title,
  description,
  plan,
  icon: Icon,
  items,
}: AdminPlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <Badge variant="secondary">{plan}</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-muted">
              <Icon className="size-5" />
            </div>
            <div>
              <CardTitle>待接入能力</CardTitle>
              <CardDescription>
                该区域已有受保护的管理入口，后续计划会接入真实数据和操作。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <div key={item} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {item}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
