import { BadgeDollarSign, Building2, Database, PackageCheck, ReceiptText, ShieldCheck, UsersRound } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { listAdminProducts } from "@/lib/product-admin-service"
import { getAccessAnalytics, getDatabaseStatus } from "@/lib/platform-health"

export default async function AdminOverviewPage() {
  const [analytics, pendingProducts, databaseStatus] = await Promise.all([
    getAccessAnalytics(),
    listAdminProducts("pending_review"),
    getDatabaseStatus(),
  ])

  const accountTotal = sumCounts(analytics.accountsByStatus)
  const organizationTotal = sumCounts(analytics.organizationsByStatus)
  const activeSubscriptions = findCount(analytics.subscriptionsByStatus, "active")
  const orderTotal = sumCounts(analytics.ordersByStatus)

  const metrics = [
    {
      detail: "平台内全部账号",
      icon: UsersRound,
      label: "账号",
      value: accountTotal.toLocaleString("zh-CN"),
    },
    {
      detail: "企业客户空间",
      icon: Building2,
      label: "企业",
      value: organizationTotal.toLocaleString("zh-CN"),
    },
    {
      detail: "等待平台确认",
      icon: PackageCheck,
      label: "产品审核",
      tone: pendingProducts.length > 0 ? "warning" : "default",
      value: pendingProducts.length.toLocaleString("zh-CN"),
    },
    {
      detail: "当前有效订阅",
      icon: BadgeDollarSign,
      label: "订阅账号",
      value: activeSubscriptions.toLocaleString("zh-CN"),
    },
    {
      detail: "订阅订单记录",
      icon: ReceiptText,
      label: "订单",
      value: orderTotal.toLocaleString("zh-CN"),
    },
    {
      detail: `${databaseStatus.totalRows.toLocaleString("zh-CN")} 行业务数据`,
      icon: Database,
      label: "数据库",
      tone: databaseStatus.connected ? "success" : "danger",
      value: databaseStatus.connected ? "已连接" : "不可用",
    },
  ] satisfies MetricCardProps[]

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">平台管理概览</h2>
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="size-3" />
              仅超级管理员可见
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">查看平台账号、企业、产品审核、订阅订单和数据库状态。</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>
    </div>
  )
}

type MetricCardProps = {
  detail: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone?: "danger" | "default" | "success" | "warning"
  value: string
}

function MetricCard({ detail, icon: Icon, label, tone = "default", value }: MetricCardProps) {
  const toneClass =
    tone === "warning"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : tone === "danger"
        ? "border-red-300 bg-red-50 text-red-950"
        : tone === "success"
          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
          : ""

  return (
    <Card className={toneClass}>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold leading-7">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground">
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  )
}

function sumCounts(rows: Array<{ count: number }>) {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

function findCount(rows: Array<{ count: number; status: string }>, status: string) {
  return rows.find((row) => row.status === status)?.count ?? 0
}
