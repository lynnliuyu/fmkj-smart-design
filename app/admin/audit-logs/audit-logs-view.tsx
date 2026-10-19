import type { AuditLogEntry } from "@/lib/platform-health"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function AuditLogsView({ logs }: { logs: AuditLogEntry[] }) {
  const actors = new Set(logs.map((log) => log.actorId ?? log.actorName).filter(Boolean))
  const modules = new Set(logs.map((log) => log.entityType))
  const latest = logs[0]?.occurredAt ? new Date(logs[0].occurredAt).toLocaleString("zh-CN") : "暂无"

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">操作日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看最近的平台管理和业务操作，包含操作人、目标对象、动作和发生时间。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="事件数" value={logs.length.toLocaleString()} />
        <Metric label="操作人数" value={actors.size.toLocaleString()} />
        <Metric label="涉及模块" value={modules.size.toLocaleString()} />
        <Metric label="最近事件" value={latest} />
      </div>

      <PlatformListCard title="最近事件">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事件</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>操作人</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <div className="font-medium">{log.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{log.description}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{actionLabel(log.action)}</div>
                  </TableCell>
                  <TableCell>
                    <div>{log.entityLabel}</div>
                    <Badge variant="outline" className="mt-1">
                      {moduleLabel(log.entityType)}
                    </Badge>
                  </TableCell>
                  <TableCell>{log.actorName ?? log.actorId ?? "系统"}</TableCell>
                  <TableCell>{new Date(log.occurredAt).toLocaleString("zh-CN")}</TableCell>
                </TableRow>
              ))}
              {!logs.length ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    暂无操作日志
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
      </PlatformListCard>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "account.created": "账号创建",
    "account.updated": "账号更新",
    "feature_flag.update": "功能开关更新",
    "organization.subscription.assigned": "企业订阅分配",
    "plan.updated": "套餐更新",
    "product.created": "产品创建",
    "product.reviewed": "产品审核",
    "product.updated": "产品更新",
    "project.created": "项目创建",
    "project.risk_toggled": "项目风险切换",
    "project.stage_advanced": "项目阶段推进",
    "project.updated": "项目更新",
    "subscription.assigned": "订阅分配",
  }

  return labels[action] ? `${labels[action]}（${action}）` : action
}

function moduleLabel(module: string) {
  const labels: Record<string, string> = {
    account: "账号",
    feature_flag: "功能开关",
    organization: "企业",
    plan: "套餐",
    product: "产品",
    project: "项目",
    quote: "报价单",
    subscription: "订阅",
    user: "用户",
  }

  return labels[module] ? `${labels[module]}（${module}）` : module
}
