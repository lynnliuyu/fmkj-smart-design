"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { Check, Save, X } from "lucide-react"

import type { PlanLimits } from "@/lib/account-system/domain"
import type { PlatformPlan } from "@/lib/account-system/platform-admin-service"
import { updatePlatformPlanClient } from "@/lib/platform-operations-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type Props = {
  initialPlans: PlatformPlan[]
}

export function PlanManagement({ initialPlans }: Props) {
  const [plans, setPlans] = useState(initialPlans)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  async function updatePlan(plan: PlatformPlan) {
    setSavingId(plan.id)
    setMessage("")
    try {
      const savedPlan = await updatePlatformPlanClient(plan)
      setPlans((current) => current.map((item) => (item.id === plan.id ? savedPlan : item)))
      setMessage("套餐已保存")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSavingId(null)
    }
  }

  function patchPlan(planId: string, patch: Partial<PlatformPlan>) {
    setPlans((current) => current.map((plan) => (plan.id === planId ? { ...plan, ...patch } : plan)))
  }

  function patchLimits(planId: string, patch: Partial<PlanLimits>) {
    setPlans((current) =>
      current.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              limits: {
                ...plan.limits,
                ...patch,
              },
            }
          : plan,
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">套餐管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          维护价格、套餐限制、点位图权限、团队权限和子账号权限。
        </p>
      </div>

      {message ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader className="border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{plan.name}</CardTitle>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="outline">{planCodeLabel(plan.planCode)}</Badge>
                    <Badge variant={plan.isActive ? "secondary" : "destructive"}>
                      {plan.isActive ? "启用" : "停用"}
                    </Badge>
                  </div>
                </div>
                <Button disabled={savingId === plan.id} onClick={() => updatePlan(plan)}>
                  <Save />
                  保存
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="套餐名称">
                  <Input value={plan.name} onChange={(event) => patchPlan(plan.id, { name: event.target.value })} />
                </Field>
                <Field label="价格（人民币）">
                  <Input
                    inputMode="decimal"
                    value={(plan.priceCents / 100).toString()}
                    onChange={(event) =>
                      patchPlan(plan.id, {
                        priceCents: Math.max(0, Math.round(Number(event.target.value || 0) * 100)),
                      })
                    }
                  />
                </Field>
                <Field label="项目数量上限">
                  <NullableNumberInput
                    value={plan.limits.maxProjects}
                    onChange={(value) => patchLimits(plan.id, { maxProjects: value })}
                  />
                </Field>
                <Field label="成员数量上限">
                  <NullableNumberInput
                    value={plan.limits.maxMembers}
                    onChange={(value) => patchLimits(plan.id, { maxMembers: value })}
                  />
                </Field>
                <Field label="存储上限（MB）">
                  <NullableNumberInput
                    value={plan.limits.storageLimitMb}
                    onChange={(value) => patchLimits(plan.id, { storageLimitMb: value })}
                  />
                </Field>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-sm font-medium">启用套餐</span>
                  <Switch checked={plan.isActive} onCheckedChange={(checked) => patchPlan(plan.id, { isActive: checked })} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Capability
                  checked={plan.limits.canUsePointMap}
                  label="点位图"
                  onChange={(value) => patchLimits(plan.id, { canUsePointMap: value })}
                />
                <Capability
                  checked={plan.limits.canUseAdvancedExport}
                  label="高级导出"
                  onChange={(value) => patchLimits(plan.id, { canUseAdvancedExport: value })}
                />
                <Capability
                  checked={plan.limits.canCreateTeam}
                  label="团队"
                  onChange={(value) => patchLimits(plan.id, { canCreateTeam: value })}
                />
                <Capability
                  checked={plan.limits.canCreateSubAccounts}
                  label="子账号"
                  onChange={(value) => patchLimits(plan.id, { canCreateSubAccounts: value })}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
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

function NullableNumberInput({
  onChange,
  value,
}: {
  onChange: (value: number | null) => void
  value: number | null
}) {
  return (
    <Input
      placeholder="不限"
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value.trim()
        onChange(next === "" ? null : Math.max(0, Number.parseInt(next, 10) || 0))
      }}
    />
  )
}

function planCodeLabel(planCode: PlatformPlan["planCode"]) {
  const labels: Record<PlatformPlan["planCode"], string> = {
    ENTERPRISE_CUSTOM: "企业定制版",
    ENTERPRISE_MONTHLY: "企业版（月付）",
    ENTERPRISE_YEARLY: "企业版（年付）",
    FREE: "个人免费版",
    PERSONAL_PRO_MONTHLY: "个人升级版（月付）",
    PERSONAL_PRO_YEARLY: "个人升级版（年付）",
  }

  return labels[planCode] ?? planCode
}

function Capability({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <span className="flex items-center gap-2 text-sm font-medium">
        {checked ? <Check className="size-4 text-primary" /> : <X className="size-4 text-muted-foreground" />}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
