"use client"

import { useState } from "react"

import type { PlatformFeatureFlag } from "@/lib/account-system/platform-admin-service"
import { updatePlatformFeatureFlagClient } from "@/lib/platform-operations-client"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function FeatureFlagManagement({
  initialFeatureFlags,
}: {
  initialFeatureFlags: PlatformFeatureFlag[]
}) {
  const [featureFlags, setFeatureFlags] = useState(initialFeatureFlags)
  const [message, setMessage] = useState("")

  async function updateFeatureFlag(flag: PlatformFeatureFlag, enabled: boolean) {
    const previous = featureFlags
    setFeatureFlags((current) =>
      current.map((item) => (item.key === flag.key ? { ...item, enabled } : item)),
    )
    setMessage("")

    try {
      const featureFlag = await updatePlatformFeatureFlagClient(flag, enabled)
      setFeatureFlags((current) =>
        current.map((item) => (item.key === featureFlag.key ? featureFlag : item)),
      )
    } catch (error) {
      setFeatureFlags(previous)
      setMessage(error instanceof Error ? error.message : "功能开关更新失败")
      return
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">平台功能开关</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          控制平台级功能入口，操作会写入审计日志。
        </p>
      </div>

      {message ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message}
        </div>
      ) : null}

      <PlatformListCard title="功能列表">
          <Table>
            <TableHeader>
              <TableRow>
                  <TableHead>功能</TableHead>
                  <TableHead>技术标识</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-20">开关</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureFlags.map((flag) => (
                <TableRow key={flag.key}>
                  <TableCell>{featureFlagLabel(flag.key)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{flag.key}</TableCell>
                  <TableCell>{flag.description ?? "未填写"}</TableCell>
                  <TableCell>
                    <Badge variant={flag.enabled ? "default" : "secondary"}>
                      {flag.enabled ? "已启用" : "已关闭"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={flag.enabled}
                      onCheckedChange={(enabled) => void updateFeatureFlag(flag, enabled)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {!featureFlags.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    暂无功能开关
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
      </PlatformListCard>
    </div>
  )
}

function featureFlagLabel(key: string) {
  const labels: Record<string, string> = {
    advanced_export: "高级导出",
    enterprise_team: "企业团队协作",
    point_map: "点位图",
  }

  return labels[key] ?? "自定义功能"
}
