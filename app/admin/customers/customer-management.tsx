"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { ArrowUpRight, Plus, RefreshCw, Save } from "lucide-react"

import type { AccountStatus, AccountType, PlanCode } from "@/lib/account-system/domain"
import type {
  PlatformCustomer,
  PlatformPlan,
} from "@/lib/account-system/platform-admin-service"
import {
  assignPlatformCustomerPlanClient,
  createPlatformCustomerClient,
  listPlatformCustomersClient,
  updatePlatformCustomerClient,
} from "@/lib/platform-operations-client"
import { PlatformListCard, PlatformRowActionItem, PlatformRowActions } from "@/app/admin/_components/platform-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Props = {
  initialCustomers: PlatformCustomer[]
  plans: PlatformPlan[]
}

const accountTypes: Array<{ label: string; value: AccountType }> = [
  { label: "个人免费版", value: "PERSONAL_FREE" },
  { label: "个人升级版", value: "PERSONAL_PRO" },
  { label: "企业主账号", value: "ENTERPRISE_OWNER" },
  { label: "企业成员", value: "ENTERPRISE_MEMBER" },
  { label: "超级管理员", value: "SUPER_ADMIN" },
]

const accountStatuses: Array<{ label: string; value: AccountStatus }> = [
  { label: "启用", value: "active" },
  { label: "禁用", value: "disabled" },
  { label: "已删除", value: "deleted" },
]

export function CustomerManagement({ initialCustomers, plans }: Props) {
  const [customers, setCustomers] = useState(initialCustomers)
  const [draft, setDraft] = useState({
    accountType: "PERSONAL_FREE" as AccountType,
    email: "",
    name: "",
    password: "",
    phone: "",
    planCode: "FREE" as PlanCode,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  const stats = useMemo(
    () => ({
      enterprise: customers.filter((customer) => customer.accountType.startsWith("ENTERPRISE")).length,
      free: customers.filter((customer) => customer.accountType === "PERSONAL_FREE").length,
      paid: customers.filter((customer) => customer.planCode && customer.planCode !== "FREE").length,
      total: customers.length,
    }),
    [customers],
  )
  const customerGroups = useMemo(() => groupCustomers(customers), [customers])

  async function refreshCustomers() {
    setCustomers(await listPlatformCustomersClient())
  }

  async function createCustomer() {
    setSaving(true)
    setMessage("")
    try {
      await createPlatformCustomerClient(draft)
      await refreshCustomers()
      setDraft({
        accountType: "PERSONAL_FREE",
        email: "",
        name: "",
        password: "",
        phone: "",
        planCode: "FREE",
      })
      setMessage("客户已创建")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }

  async function updateCustomer(customer: PlatformCustomer, patch: Partial<PlatformCustomer>) {
    const next = { ...customer, ...patch }
    setCustomers((current) => current.map((item) => (item.id === customer.id ? next : item)))
    setMessage("")

    try {
      await updatePlatformCustomerClient({
        accountStatus: next.accountStatus,
        accountType: next.accountType,
        customerId: customer.id,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "客户更新失败")
      await refreshCustomers()
      return
    }
  }

  async function assignPlan(customer: PlatformCustomer, planCode: PlanCode) {
    setCustomers((current) =>
      current.map((item) =>
        item.id === customer.id
          ? {
              ...item,
              planCode,
              planName: plans.find((plan) => plan.planCode === planCode)?.name ?? item.planName,
            }
          : item,
      ),
    )
    setMessage("")

    try {
      await assignPlatformCustomerPlanClient(customer.id, planCode)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "套餐分配失败")
      await refreshCustomers()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">账号管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建客户账号，分配账号身份，并管理当前套餐和账号状态。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refreshCustomers}>
            <RefreshCw />
            刷新
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                新建客户
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>新建客户</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="客户名称">
                  <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </Field>
                <Field label="邮箱">
                  <Input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
                </Field>
                <Field label="电话">
                  <Input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
                </Field>
                <Field label="初始密码">
                  <Input
                    type="password"
                    value={draft.password}
                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                  />
                </Field>
                <Field label="账号类型">
                  <Select
                    value={draft.accountType}
                    onValueChange={(value) => setDraft({ ...draft, accountType: value as AccountType })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="套餐">
                  <Select
                    value={draft.planCode}
                    onValueChange={(value) => setDraft({ ...draft, planCode: value as PlanCode })}
                  >
                    <SelectTrigger className="w-full">
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
                </Field>
              </div>
              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              <Button disabled={saving} onClick={createCustomer}>
                <Save />
                保存客户
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {message ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="客户总数" value={stats.total} />
        <Metric label="付费账号" value={stats.paid} />
        <Metric label="企业账号" value={stats.enterprise} />
        <Metric label="免费账号" value={stats.free} />
      </div>

      <PlatformListCard title="账号列表">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客户</TableHead>
                <TableHead>账号类型</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className="w-20 text-right">详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerGroups.map((group) => (
                <CustomerGroupRows
                  key={group.owner.id}
                  group={group}
                  plans={plans}
                  onAssignPlan={assignPlan}
                  onUpdateCustomer={updateCustomer}
                />
              ))}
              {!customers.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    暂无客户账号
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
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function AccountBadge({ type }: { type: AccountType }) {
  const label = accountTypes.find((item) => item.value === type)?.label ?? type
  return <Badge variant={type === "SUPER_ADMIN" ? "default" : "secondary"}>{label}</Badge>
}

type CustomerGroup = {
  members: PlatformCustomer[]
  owner: PlatformCustomer
}

function CustomerGroupRows({
  group,
  onAssignPlan,
  onUpdateCustomer,
  plans,
}: {
  group: CustomerGroup
  onAssignPlan: (customer: PlatformCustomer, planCode: PlanCode) => void
  onUpdateCustomer: (customer: PlatformCustomer, patch: Partial<PlatformCustomer>) => void
  plans: PlatformPlan[]
}) {
  return (
    <>
      <CustomerRow
        customer={group.owner}
        memberCount={group.members.length}
        onAssignPlan={onAssignPlan}
        onUpdateCustomer={onUpdateCustomer}
        plans={plans}
      />
      {group.members.map((member) => (
        <CustomerRow
          key={member.id}
          child
          customer={member}
          onAssignPlan={onAssignPlan}
          onUpdateCustomer={onUpdateCustomer}
          plans={plans}
        />
      ))}
    </>
  )
}

function CustomerRow({
  child,
  customer,
  memberCount = 0,
  onAssignPlan,
  onUpdateCustomer,
  plans,
}: {
  child?: boolean
  customer: PlatformCustomer
  memberCount?: number
  onAssignPlan: (customer: PlatformCustomer, planCode: PlanCode) => void
  onUpdateCustomer: (customer: PlatformCustomer, patch: Partial<PlatformCustomer>) => void
  plans: PlatformPlan[]
}) {
  if (child) {
    const roleLabel = accountTypes.find((type) => type.value === customer.accountType)?.label ?? customer.accountType
    return (
      <TableRow className="bg-muted/25 py-1">
        <TableCell colSpan={6}>
          <div className="flex items-center gap-2 pl-4 text-sm">
            <span className="font-medium">{customer.name}</span>
            <span className="text-xs text-muted-foreground">{customer.email ?? customer.phone}</span>
            <Badge variant="outline">{roleLabel}</Badge>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium">{customer.name}</div>
            {memberCount > 0 ? <Badge variant="secondary">{memberCount} 个子账号</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">{customer.email ?? customer.phone}</div>
          {customer.organizationName ? (
            <div className="mt-1 text-xs text-muted-foreground">
              企业：{customer.organizationName}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={customer.accountType}
          onValueChange={(value) => onUpdateCustomer(customer, { accountType: value as AccountType })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accountTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select value={customer.planCode ?? "FREE"} onValueChange={(value) => onAssignPlan(customer, value as PlanCode)}>
          <SelectTrigger className="w-44">
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
          value={customer.accountStatus}
          onValueChange={(value) => onUpdateCustomer(customer, { accountStatus: value as AccountStatus })}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accountStatuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleString("zh-CN") : "从未登录"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end">
          <PlatformRowActions>
            <PlatformRowActionItem asChild>
              <Link href={`/admin/customers/${customer.id}`}>
                <ArrowUpRight />
                查看详情
              </Link>
            </PlatformRowActionItem>
          </PlatformRowActions>
        </div>
      </TableCell>
    </TableRow>
  )
}

function groupCustomers(customers: PlatformCustomer[]): CustomerGroup[] {
  const ownerByOrganization = new Map<string, PlatformCustomer>()
  const groupedMemberIds = new Set<string>()

  for (const customer of customers) {
    if (!customer.organizationId) continue
    if (customer.organizationOwnerUserId === customer.id || customer.accountType === "ENTERPRISE_OWNER") {
      ownerByOrganization.set(customer.organizationId, customer)
    }
  }

  return customers.flatMap((customer) => {
    if (groupedMemberIds.has(customer.id)) return []

    const ownsOrganization =
      customer.organizationId &&
      (customer.organizationOwnerUserId === customer.id || customer.accountType === "ENTERPRISE_OWNER")

    if (ownsOrganization) {
      const members = customers.filter(
        (member) =>
          member.id !== customer.id &&
          member.organizationId === customer.organizationId &&
          member.organizationOwnerUserId === customer.id
      )
      members.forEach((member) => groupedMemberIds.add(member.id))
      return [{ members, owner: customer }]
    }

    const owner = customer.organizationId ? ownerByOrganization.get(customer.organizationId) : null
    if (owner && owner.id !== customer.id) {
      groupedMemberIds.add(customer.id)
      return []
    }

    return [{ members: [], owner: customer }]
  })
}
