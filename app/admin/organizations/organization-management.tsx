"use client"

import { useMemo, useState } from "react"
import { RefreshCw, Save } from "lucide-react"

import type { PlanCode, SubscriptionStatus } from "@/lib/account-system/domain"
import type {
  PlatformOrganization,
  PlatformPlan,
} from "@/lib/account-system/platform-admin-service"
import { PlatformListCard } from "@/app/admin/_components/platform-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Props = {
  initialOrganizations: PlatformOrganization[]
  plans: PlatformPlan[]
}

const subscriptionStatuses: Array<{ label: string; value: SubscriptionStatus }> = [
  { label: "正常", value: "active" },
  { label: "宽限期", value: "grace_period" },
  { label: "逾期", value: "past_due" },
  { label: "已过期", value: "expired" },
  { label: "已取消", value: "canceled" },
]

export function OrganizationManagement({ initialOrganizations, plans }: Props) {
  const [organizations, setOrganizations] = useState(initialOrganizations)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  const stats = useMemo(
    () => ({
      active: organizations.filter((organization) => organization.status === "active").length,
      expired: organizations.filter(
        (organization) =>
          organization.status === "expired" || organization.subscriptionStatus === "expired",
      ).length,
      members: organizations.reduce((sum, organization) => sum + organization.memberCount, 0),
      total: organizations.length,
    }),
    [organizations],
  )

  async function refreshOrganizations() {
    const response = await fetch("/api/admin/organizations")
    const data = (await response.json()) as { organizations?: PlatformOrganization[] }
    if (response.ok && data.organizations) setOrganizations(data.organizations)
  }

  async function updateSubscription(
    organization: PlatformOrganization,
    patch: { planCode?: PlanCode; subscriptionStatus?: SubscriptionStatus },
  ) {
    const previous = organizations
    const next = {
      ...organization,
      planCode: patch.planCode ?? organization.planCode,
      planName:
        plans.find((plan) => plan.planCode === patch.planCode)?.name ??
        organization.planName,
      subscriptionStatus: patch.subscriptionStatus ?? organization.subscriptionStatus,
    }

    setOrganizations((current) =>
      current.map((item) => (item.id === organization.id ? next : item)),
    )
    setSavingId(organization.id)
    setMessage("")

    const response = await fetch(`/api/admin/organizations/${organization.id}/subscription`, {
      body: JSON.stringify({
        planCode: next.planCode ?? "ENTERPRISE_MONTHLY",
        status: next.subscriptionStatus ?? "active",
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
    const data = (await response.json()) as {
      error?: string
      organization?: PlatformOrganization
    }

    setSavingId(null)

    if (!response.ok || !data.organization) {
      setOrganizations(previous)
      setMessage(data.error ?? "企业订阅更新失败")
      return
    }

    setOrganizations((current) =>
      current.map((item) => (item.id === data.organization?.id ? data.organization : item)),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">企业管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看企业空间、主账号、成员数，并调整企业订阅套餐和到期状态。
          </p>
        </div>
        <Button variant="outline" onClick={refreshOrganizations}>
          <RefreshCw />
          刷新
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="企业总数" value={stats.total} />
        <Metric label="正常企业" value={stats.active} />
        <Metric label="异常/过期" value={stats.expired} />
        <Metric label="团队成员" value={stats.members} />
      </div>

      <PlatformListCard title="企业列表">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>企业</TableHead>
                <TableHead>主账号</TableHead>
                <TableHead>成员</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead>订阅状态</TableHead>
                <TableHead>企业状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell>
                    <div className="font-medium">{organization.name}</div>
                    <div className="text-xs text-muted-foreground">{organization.id}</div>
                  </TableCell>
                  <TableCell>
                    <div>{organization.ownerName ?? "未命名主账号"}</div>
                    <div className="text-xs text-muted-foreground">
                      {organization.ownerEmail ?? organization.ownerUserId}
                    </div>
                  </TableCell>
                  <TableCell>{organization.memberCount}</TableCell>
                  <TableCell>
                    <Select
                      value={organization.planCode ?? "ENTERPRISE_MONTHLY"}
                      onValueChange={(value) =>
                        void updateSubscription(organization, { planCode: value as PlanCode })
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.planCode}>
                            {plan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={organization.subscriptionStatus ?? "active"}
                      onValueChange={(value) =>
                        void updateSubscription(organization, {
                          subscriptionStatus: value as SubscriptionStatus,
                        })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {subscriptionStatuses.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={organization.status === "active" ? "secondary" : "destructive"}>
                        {organizationStatusLabel(organization.status)}
                      </Badge>
                      {savingId === organization.id ? (
                        <Save className="size-4 animate-pulse text-muted-foreground" />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!organizations.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    暂无企业空间
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
      </PlatformListCard>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
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
