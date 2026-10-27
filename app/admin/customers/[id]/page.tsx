import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CalendarClock, Mail, Phone, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/format-datetime"
import { Separator } from "@/components/ui/separator"
import {
  getPlatformCustomer,
  listPlatformPlans,
} from "@/lib/account-system/platform-admin-service"

import { AccountBadge } from "../customer-management"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AdminCustomerDetailPage({ params }: PageProps) {
  const { id } = await params
  const [customer, plans] = await Promise.all([getPlatformCustomer(id), listPlatformPlans()])

  if (!customer) {
    notFound()
  }

  const activePlan = plans.find((plan) => plan.planCode === customer.planCode)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Button asChild variant="outline" size="icon-sm">
            <Link href="/admin/customers">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{customer.name}</h1>
              <AccountBadge type={customer.accountType} />
              <Badge variant={customer.accountStatus === "active" ? "secondary" : "destructive"}>
                {accountStatusLabel(customer.accountStatus)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              查看客户账号、订阅套餐和最近平台操作。
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>账号资料</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <InfoRow icon={Mail} label="邮箱" value={customer.email ?? "未设置"} />
            <InfoRow icon={Phone} label="电话" value={customer.phone ?? "未设置"} />
            <InfoRow icon={ShieldCheck} label="账号类型" value={accountTypeLabel(customer.accountType)} />
            <InfoRow
              icon={CalendarClock}
              label="最近登录"
              value={customer.lastLoginAt ? formatDateTime(customer.lastLoginAt) : "从未登录"}
            />
            <Separator />
            <div className="grid gap-1">
              <div className="text-sm font-medium">当前套餐</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{customer.planCode ? planCodeLabel(customer.planCode) : "未分配"}</Badge>
                <span className="text-sm text-muted-foreground">{customer.planName ?? "暂无有效套餐"}</span>
              </div>
              {customer.subscriptionStatus ? (
                <div className="text-xs text-muted-foreground">
                  订阅状态：{subscriptionStatusLabel(customer.subscriptionStatus)}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>套餐限制</CardTitle>
          </CardHeader>
          <CardContent>
            {activePlan ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Limit label="项目数" value={formatLimit(activePlan.limits.maxProjects)} />
                <Limit label="成员数" value={formatLimit(activePlan.limits.maxMembers)} />
                <Limit label="存储" value={formatStorage(activePlan.limits.storageLimitMb)} />
                <Limit label="支持等级" value={supportLevelLabel(activePlan.limits.supportLevel)} />
                <Limit label="点位图" value={activePlan.limits.canUsePointMap ? "已启用" : "已禁用"} />
                <Limit label="团队" value={activePlan.limits.canCreateTeam ? "已启用" : "已禁用"} />
                <Limit label="子账号" value={activePlan.limits.canCreateSubAccounts ? "已启用" : "已禁用"} />
                <Limit label="高级导出" value={activePlan.limits.canUseAdvancedExport ? "已启用" : "已禁用"} />
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                请先在客户列表分配套餐，再查看限制。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近活动</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.activities.length > 0 ? (
            <div className="grid gap-3">
              {customer.activities.map((activity) => (
                <div key={`${activity.action}-${activity.occurredAt}`} className="rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{activity.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(activity.occurredAt)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{activity.description}</div>
                  <Badge className="mt-2" variant="outline">
                    {activity.action}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              暂时没有账号活动记录。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

function formatLimit(value: number | null) {
  return value === null ? "不限" : String(value)
}

function formatStorage(value: number | null) {
  return value === null ? "不限" : `${value} MB`
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

function supportLevelLabel(level: string) {
  const labels: Record<string, string> = {
    dedicated: "专属支持",
    enterprise: "企业支持",
    priority: "优先支持",
    standard: "标准支持",
  }

  return labels[level] ?? level
}
