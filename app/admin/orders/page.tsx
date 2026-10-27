import { listPlatformOrders } from "@/lib/account-system/platform-admin-service"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format-datetime"

const statusLabels = {
  canceled: "已取消",
  failed: "失败",
  paid: "已支付",
  pending: "待支付",
  refunded: "已退款",
}

export default async function AdminOrdersPage() {
  const orders = await listPlatformOrders()
  const paidOrders = orders.filter((order) => order.status === "paid")
  const paidAmount = paidOrders.reduce((sum, order) => sum + order.amountCents, 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">订单管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看个人和企业订阅订单、支付状态、金额和关联套餐。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="订单数" value={orders.length.toLocaleString()} />
        <Metric label="已支付" value={paidOrders.length.toLocaleString()} />
        <Metric label="已支付金额" value={formatMoney(paidAmount)} />
      </div>

      <PlatformListCard title="最近订单">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{order.subjectLabel}</div>
                    <div className="text-xs text-muted-foreground">{subjectTypeLabel(order.subjectType)}</div>
                  </TableCell>
                  <TableCell>{order.planName ?? (order.planCode ? planCodeLabel(order.planCode) : "未绑定套餐")}</TableCell>
                  <TableCell>{formatMoney(order.amountCents)}</TableCell>
                  <TableCell>
                    <Badge variant={order.status === "paid" ? "default" : "outline"}>
                      {statusLabels[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(order.createdAt)}</TableCell>
                </TableRow>
              ))}
              {!orders.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    暂无订单
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

function formatMoney(amountCents: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(amountCents / 100)
}

function planCodeLabel(planCode: string) {
  const labels: Record<string, string> = {
    ENTERPRISE_CUSTOM: "企业定制版",
    ENTERPRISE_MONTHLY: "企业版（月付）",
    ENTERPRISE_YEARLY: "企业版（年付）",
    FREE: "个人免费版",
    PERSONAL_PRO_MONTHLY: "个人升级版（月付）",
    PERSONAL_PRO_YEARLY: "个人升级版（年付）",
  }

  return labels[planCode] ?? planCode
}

function subjectTypeLabel(subjectType: string) {
  const labels: Record<string, string> = {
    organization: "企业",
    user: "个人",
  }

  return labels[subjectType] ?? subjectType
}
