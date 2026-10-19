import type { AccessAnalytics } from "@/lib/platform-health"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function AnalyticsView({ analytics }: { analytics: AccessAnalytics }) {
  const accountTotal = sumCounts(analytics.accountsByType)
  const organizationTotal = sumCounts(analytics.organizationsByStatus)
  const subscriptionTotal = sumCounts(analytics.subscriptionsByStatus)
  const orderTotal = sumCounts(analytics.ordersByStatus)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">数据统计</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看账号、企业、订阅、订单和操作热度的运营概览。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="账号总数" value={accountTotal.toLocaleString()} />
        <Metric label="企业总数" value={organizationTotal.toLocaleString()} />
        <Metric label="订阅记录" value={subscriptionTotal.toLocaleString()} />
        <Metric label="已支付金额" value={formatCny(analytics.paidRevenueCents)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankTable
          title="账号类型"
          nameHeader="类型"
          rows={analytics.accountsByType.map((row) => ({ count: row.count, name: accountTypeLabel(row.type) }))}
        />
        <RankTable
          title="账号状态"
          nameHeader="状态"
          rows={analytics.accountsByStatus.map((row) => ({ count: row.count, name: accountStatusLabel(row.status) }))}
        />
        <RankTable
          title="企业状态"
          nameHeader="状态"
          rows={analytics.organizationsByStatus.map((row) => ({ count: row.count, name: organizationStatusLabel(row.status) }))}
        />
        <RankTable
          title="订阅状态"
          nameHeader="状态"
          rows={analytics.subscriptionsByStatus.map((row) => ({ count: row.count, name: subscriptionStatusLabel(row.status) }))}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="24 小时操作数" value={analytics.actions24h.toLocaleString()} />
        <Metric label="7 天活跃操作人" value={analytics.activeActors7d.toLocaleString()} />
        <Metric label="有记录天数" value={analytics.actions7d.length.toLocaleString()} />
        <Metric label="订单数" value={orderTotal.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankTable
          title="高频动作"
          nameHeader="动作"
          rows={analytics.topActions.map((row) => ({ count: row.count, name: actionLabel(row.action) }))}
        />
        <RankTable
          title="高频模块"
          nameHeader="模块"
          rows={analytics.topModules.map((row) => ({ count: row.count, name: moduleLabel(row.module) }))}
        />
        <RankTable
          title="订单状态"
          nameHeader="状态"
          rows={analytics.ordersByStatus.map((row) => ({
            count: row.count,
            name: `${orderStatusLabel(row.status)} · ${formatCny(row.totalCents)}`,
          }))}
        />
      </div>
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

function RankTable({
  nameHeader,
  rows,
  title,
}: {
  nameHeader: string
  rows: Array<{ count: number; name: string }>
  title: string
}) {
  return (
    <PlatformListCard title={title}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{nameHeader}</TableHead>
              <TableHead className="text-right">数量</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right">{row.count.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={2} className="h-20 text-center text-sm text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
    </PlatformListCard>
  )
}

function sumCounts(rows: Array<{ count: number }>) {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

function formatCny(cents: number) {
  return `￥${(cents / 100).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`
}

function accountStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "启用",
    deleted: "已删除",
    disabled: "禁用",
  }

  return labels[status] ?? status
}

function accountTypeLabel(type: string) {
  const labels: Record<string, string> = {
    ENTERPRISE_MEMBER: "企业成员",
    ENTERPRISE_OWNER: "企业主账号",
    PERSONAL_FREE: "个人免费版",
    PERSONAL_PRO: "个人升级版",
    SUPER_ADMIN: "超级管理员",
  }

  return labels[type] ?? type
}

function organizationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "启用",
    deleted: "已删除",
    disabled: "禁用",
    expired: "已过期",
  }

  return labels[status] ?? status
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    canceled: "已取消",
    failed: "失败",
    paid: "已支付",
    pending: "待支付",
    refunded: "已退款",
  }

  return labels[status] ?? status
}

function subscriptionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "生效中",
    canceled: "已取消",
    expired: "已过期",
    free: "免费",
    grace_period: "宽限期",
    past_due: "逾期",
  }

  return labels[status] ?? status
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
