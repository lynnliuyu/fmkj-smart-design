"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ClipboardCheck,
  Cog,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  Wrench,
} from "lucide-react"

import {
  computeLineTotal,
  formatCents,
  PRICING_MODE_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type WorkOrder,
  type WorkOrderType,
  type WorkPricingCatalogEntry,
  type WorkPricingMode,
} from "@/lib/work-order-shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type StatusFilter = "all" | "draft" | "scheduled" | "in_progress" | "done" | "canceled"

const STATUS_FILTERS: StatusFilter[] = ["all", "draft", "scheduled", "in_progress", "done", "canceled"]

const TYPE_OPTIONS: Array<{ label: string; value: WorkOrderType }> = [
  { label: "复尺", value: "measure" },
  { label: "安装", value: "install" },
  { label: "调试", value: "commission" },
  { label: "售后", value: "after_sale" },
]

const TYPE_BADGE_TONE: Record<WorkOrderType, string> = {
  measure: "border-amber-200 bg-amber-50 text-amber-700",
  install: "border-emerald-200 bg-emerald-50 text-emerald-700",
  commission: "border-blue-200 bg-blue-50 text-blue-700",
  after_sale: "border-purple-200 bg-purple-50 text-purple-700",
}

const STATUS_TONE: Record<string, string> = {
  draft: "border-muted text-muted-foreground",
  scheduled: "border-blue-200 text-blue-700",
  in_progress: "border-emerald-200 text-emerald-700",
  done: "border-zinc-200 text-zinc-700",
  canceled: "border-red-200 text-red-700",
}

type QuoteItem = {
  id: string
  name: string
  spec: string | null
  unit: string
  quantity: number
  room: string | null
  unitPriceCents: number | null
}

type DraftLine = {
  catalogCode: string | null
  workType: WorkOrderType
  name: string
  description: string | null
  pricingMode: WorkPricingMode
  quantity: number
  unitName: string
  unitPriceCents: number
  note: string | null
  sortOrder: number
}

export function WorkOrdersClient({
  canManagePricing,
}: {
  canManagePricing: boolean
}) {
  const [orders, setOrders] = React.useState<WorkOrder[]>([])
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  const [search, setSearch] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [newOrderOpen, setNewOrderOpen] = React.useState(false)
  const [pricingOpen, setPricingOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  async function loadOrders() {
    setIsLoading(true)
    try {
      const res = await fetch("/api/work-orders")
      const payload = await res.json()
      setOrders(payload.data ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载工单失败")
    } finally {
      setIsLoading(false)
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrders()
  }, [])

  const filtered = React.useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false
      if (!keyword) return true
      return [order.code, order.title, order.projectName, order.projectCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    })
  }, [orders, statusFilter, search])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">工单</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按项目创建工单，工程师完成后自动按标准计价、可由公司主账号定价。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManagePricing ? (
            <Button variant="outline" onClick={() => setPricingOpen(true)}>
              <Cog className="size-4" />
              配置计价
            </Button>
          ) : null}
          <Button onClick={() => setNewOrderOpen(true)}>
            <Plus className="size-4" />
            新建工单
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={statusFilter === status ? "default" : "outline"}
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "全部" : WORK_ORDER_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜工单号 / 项目"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          加载中…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <Wrench className="size-10" />
            <div>暂无工单，点击右上角「新建工单」开始。</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((order) => (
            <WorkOrderCard key={order.id} order={order} onOpen={() => setDetailId(order.id)} />
          ))}
        </div>
      )}

      <NewWorkOrderDialog
        open={newOrderOpen}
        onOpenChange={setNewOrderOpen}
        onCreated={(order) => {
          setOrders((current) => [order, ...current])
          setNewOrderOpen(false)
          toast.success(`工单 ${order.code} 已创建`)
          setDetailId(order.id)
        }}
      />

      <WorkOrderDetailDialog
        workOrderId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        onUpdated={(updated) =>
          setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        }
      />

      {canManagePricing ? (
        <WorkPricingDialog open={pricingOpen} onOpenChange={setPricingOpen} />
      ) : null}
    </div>
  )
}

function WorkOrderCard({ order, onOpen }: { order: WorkOrder; onOpen: () => void }) {
  const workTypes = Array.isArray(order.workTypes) ? order.workTypes : []
  const items = Array.isArray(order.items) ? order.items : []
  return (
    <Card className="cursor-pointer transition hover:shadow-md" onClick={onOpen}>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">{order.title}</CardTitle>
          <Badge variant="outline" className={cn("font-normal", STATUS_TONE[order.status])}>
            {WORK_ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {order.code} · {order.projectName ?? "—"}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1">
          {workTypes.map((type) => (
            <Badge key={type} variant="outline" className={cn("font-normal", TYPE_BADGE_TONE[type])}>
              {WORK_ORDER_TYPE_LABELS[type]}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>优先级：{WORK_ORDER_PRIORITY_LABELS[order.priority]}</span>
          <span>携带 {items.length} 项产品</span>
        </div>
        {order.status === "done" ? (
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs">
            <span>完工金额</span>
            <span className="font-medium">{formatCents(order.finalFeeCents)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function NewWorkOrderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (order: WorkOrder) => void
}) {
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string; code: string }>>([])
  const [projectId, setProjectId] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [workTypes, setWorkTypes] = React.useState<Set<WorkOrderType>>(new Set(["measure"]))
  const [priority, setPriority] = React.useState<"low" | "normal" | "high">("normal")
  const [quoteItems, setQuoteItems] = React.useState<QuoteItem[]>([])
  const [selectedItemIds, setSelectedItemIds] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  const [loadingQuote, setLoadingQuote] = React.useState(false)

  async function loadProjects() {
    try {
      const res = await fetch("/api/projects")
      const payload = await res.json()
      const list = (payload.data ?? []).map((item: { id: string; name: string; code: string }) => ({
        id: item.id,
        name: item.name,
        code: item.code,
      }))
      setProjects(list)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载项目失败")
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadProjects()
  }, [open])

  async function loadQuoteItems(pid: string) {
    setLoadingQuote(true)
    try {
      const res = await fetch(`/api/quotes?projectId=${encodeURIComponent(pid)}`)
      const payload = await res.json()
      const items: QuoteItem[] = (payload.data?.items ?? []).map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        spec: item.spec ? String(item.spec) : null,
        unit: String(item.unit ?? "个"),
        quantity: Number(item.quantity ?? 1),
        room: item.room ? String(item.room) : null,
        unitPriceCents: item.unitPriceCents ? Number(item.unitPriceCents) : null,
      }))
      setQuoteItems(items)
      setSelectedItemIds(new Set(items.map((item) => item.id)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载报价单失败")
    } finally {
      setLoadingQuote(false)
    }
  }

  React.useEffect(() => {
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuoteItems([])
      setSelectedItemIds(new Set())
      return
    }
    void loadQuoteItems(projectId)
  }, [projectId])

  function toggleType(type: WorkOrderType) {
    setWorkTypes((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  async function handleSubmit() {
    if (!projectId) return toast.error("请选择项目")
    if (workTypes.size === 0) return toast.error("请至少选择一种工单类型")
    const items = quoteItems
      .filter((item) => selectedItemIds.has(item.id))
      .map((item) => ({
        quoteItemId: item.id,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: item.quantity,
        room: item.room,
        unitPriceCents: item.unitPriceCents ?? 0,
      }))
    if (items.length === 0) return toast.error("请至少携带一项报价产品")

    setSaving(true)
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim() || `${Array.from(workTypes).map((t) => WORK_ORDER_TYPE_LABELS[t]).join("/")}工单`,
          workTypes: Array.from(workTypes),
          priority,
          items,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? "创建失败")
      onCreated(payload.data as WorkOrder)
      // reset
      setProjectId("")
      setTitle("")
      setWorkTypes(new Set(["measure"]))
      setPriority("normal")
      setSelectedItemIds(new Set())
      setQuoteItems([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>选择项目与工单类型，从报价单携带产品，工程师完成后自动按标准计价。</DialogDescription>
        </DialogHeader>
        <ScrollArea className="-mx-6 max-h-[70vh] flex-1 px-6">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>项目 *</FieldLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} · {project.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>工单标题</FieldLabel>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="留空将按所选类型自动生成"
              />
            </Field>

            <FieldSet>
              <FieldLabel>工单类型 *（可多选）</FieldLabel>
              <FieldDescription>不同类型对应不同标准工作条目，公司主账号可在「配置计价」中调整。</FieldDescription>
              <FieldContent className="flex flex-wrap gap-2 pt-1">
                {TYPE_OPTIONS.map((option) => {
                  const active = workTypes.has(option.value)
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleType(option.value)}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </FieldContent>
            </FieldSet>

            <Field>
              <FieldLabel>优先级</FieldLabel>
              <Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="normal">普通</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <FieldSet>
              <FieldLabel>携带报价产品</FieldLabel>
              <FieldDescription>默认全选该项目报价单产品，可手动取消勾选。</FieldDescription>
              <FieldContent className="pt-1">
                {loadingQuote ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    正在加载报价单…
                  </div>
                ) : !projectId ? (
                  <div className="text-sm text-muted-foreground">请先选择项目</div>
                ) : quoteItems.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    该项目暂无可携带的报价产品。请先在「方案报价」中保存报价单。
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {quoteItems.map((item) => {
                      const checked = selectedItemIds.has(item.id)
                      return (
                        <label
                          key={item.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 p-2 text-sm transition",
                            checked ? "bg-primary/5" : "hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-0.5">
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.room ?? "未指定房间"} · {item.quantity} {item.unit}
                              {item.spec ? ` · ${item.spec}` : ""}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </FieldContent>
            </FieldSet>
          </FieldGroup>
        </ScrollArea>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkOrderDetailDialog({
  workOrderId,
  onOpenChange,
  onUpdated,
}: {
  workOrderId: string | null
  onOpenChange: (open: boolean) => void
  onUpdated: (order: WorkOrder) => void
}) {
  const [order, setOrder] = React.useState<WorkOrder | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [completeOpen, setCompleteOpen] = React.useState(false)

  async function load(id: string) {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(id)}`)
      const payload = await res.json()
      setOrder(payload.data ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载工单失败")
    } finally {
      setIsLoading(false)
    }
  }

  React.useEffect(() => {
    if (workOrderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load(workOrderId)
      setCompleteOpen(false)
    } else {
      setOrder(null)
    }
  }, [workOrderId])

  async function handleStartOrAdvance() {
    if (!order) return
    const nextStatus = order.status === "draft" ? "scheduled" : order.status === "scheduled" ? "in_progress" : null
    if (!nextStatus) return
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? "更新失败")
      setOrder(payload.data)
      onUpdated(payload.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败")
    }
  }

  return (
    <Dialog open={Boolean(workOrderId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order?.title ?? "工单详情"}
            {order ? (
              <Badge variant="outline" className={cn("font-normal", STATUS_TONE[order.status])}>
                {WORK_ORDER_STATUS_LABELS[order.status]}
              </Badge>
            ) : null}
          </DialogTitle>
          {order ? (
            <DialogDescription>
              {order.code} ·{" "}
              <Link href={`/projects/${order.projectId}`} className="underline">
                {order.projectName ?? "—"}
              </Link>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {isLoading || !order ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {order.workTypes.map((type) => (
                  <Badge key={type} variant="outline" className={cn("font-normal", TYPE_BADGE_TONE[type])}>
                    {WORK_ORDER_TYPE_LABELS[type]}
                  </Badge>
                ))}
                <Badge variant="outline" className="font-normal">
                  优先级 {WORK_ORDER_PRIORITY_LABELS[order.priority]}
                </Badge>
                {order.assigneeName ? (
                  <Badge variant="outline" className="font-normal">
                    负责人 {order.assigneeName}
                  </Badge>
                ) : null}
              </div>

              <FieldSet>
                <FieldLabel>携带产品（{order.items.length} 项）</FieldLabel>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs [white-space:normal] break-words">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-2 font-medium">产品</th>
                        <th className="p-2 font-medium">房间</th>
                        <th className="p-2 font-medium text-right">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td className="p-2">
                            <div className="font-medium">{item.name}</div>
                            {item.spec ? <div className="text-muted-foreground">{item.spec}</div> : null}
                          </td>
                          <td className="p-2 text-muted-foreground">{item.room ?? "—"}</td>
                          <td className="p-2 text-right">
                            {item.actualQuantity ?? item.quantity} {item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FieldSet>

              {order.status === "done" ? (
                <>
                  <FieldSet>
                    <FieldLabel>工作明细</FieldLabel>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-xs [white-space:normal] break-words">
                        <thead className="bg-muted/40 text-left">
                          <tr>
                            <th className="p-2 font-medium">项目</th>
                            <th className="p-2 font-medium">计价方式</th>
                            <th className="p-2 font-medium text-right">数量</th>
                            <th className="p-2 font-medium text-right">单价</th>
                            <th className="p-2 font-medium text-right">小计</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {order.workLines.map((line) => (
                            <tr key={line.id}>
                              <td className="p-2">
                                <div className="font-medium">{line.name}</div>
                                {line.note ? <div className="text-muted-foreground">{line.note}</div> : null}
                              </td>
                              <td className="p-2 text-muted-foreground">{PRICING_MODE_LABELS[line.pricingMode]}</td>
                              <td className="p-2 text-right">
                                {line.quantity} {line.unitName}
                              </td>
                              <td className="p-2 text-right">{formatCents(line.unitPriceCents)}</td>
                              <td className="p-2 text-right">{formatCents(line.lineTotalCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/30 font-medium">
                            <td className="p-2" colSpan={4}>
                              合计
                            </td>
                            <td className="p-2 text-right">{formatCents(order.finalFeeCents)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </FieldSet>

                  {order.completionContent ? (
                    <FieldSet>
                      <FieldLabel>完成内容</FieldLabel>
                      <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{order.completionContent}</pre>
                    </FieldSet>
                  ) : null}
                </>
              ) : null}
            </div>
          </ScrollArea>
        )}

        {order && order.status !== "done" && order.status !== "canceled" ? (
          <DialogFooter className="gap-2">
            {order.status === "draft" || order.status === "scheduled" ? (
              <Button variant="outline" onClick={handleStartOrAdvance}>
                {order.status === "draft" ? "派单" : "开始施工"}
              </Button>
            ) : null}
            {order.status === "in_progress" ? (
              <Button onClick={() => setCompleteOpen(true)}>
                <ClipboardCheck className="size-4" />
                完成工单
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>

      {order ? (
        <CompleteWorkOrderDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          order={order}
          onCompleted={(updated) => {
            setOrder(updated)
            onUpdated(updated)
            setCompleteOpen(false)
          }}
        />
      ) : null}
    </Dialog>
  )
}

function CompleteWorkOrderDialog({
  open,
  onOpenChange,
  order,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: WorkOrder
  onCompleted: (updated: WorkOrder) => void
}) {
  const [content, setContent] = React.useState("")
  const [note, setNote] = React.useState("")
  const [lines, setLines] = React.useState<DraftLine[]>([])
  const [actualQuantities, setActualQuantities] = React.useState<Record<string, number>>({})
  const [loadingDraft, setLoadingDraft] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [photoUploading, setPhotoUploading] = React.useState(false)
  const [photoIds, setPhotoIds] = React.useState<string[]>([])
  const photoInputRef = React.useRef<HTMLInputElement | null>(null)

  async function loadDraft() {
    if (!order) return
    setLoadingDraft(true)
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-draft" }),
      })
      const payload = await res.json()
      const draft = payload.data
      setContent(draft.content ?? "")
      setNote(draft.note ?? "")
      setLines((draft.workLines ?? []) as DraftLine[])
      setActualQuantities(
        Object.fromEntries((draft.actualQuantities ?? []).map((entry: { itemId: string; actualQuantity: number }) => [entry.itemId, entry.actualQuantity])),
      )
      setPhotoIds([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成草稿失败")
    } finally {
      setLoadingDraft(false)
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && order) void loadDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id])

  const totalFeeCents = React.useMemo(() => {
    const productCount = order.items.length
    return lines.reduce(
      (sum, line) => sum + computeLineTotal(line.pricingMode, line.quantity, line.unitPriceCents, productCount),
      0,
    )
  }, [lines, order.items.length])

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index))
  }

  function addBlankLine() {
    setLines((current) => [
      ...current,
      {
        catalogCode: null,
        workType: order.workTypes[0] ?? "other" as WorkOrderType,
        name: "",
        description: null,
        pricingMode: "fixed",
        quantity: 1,
        unitName: "次",
        unitPriceCents: 0,
        note: null,
        sortOrder: current.length,
      },
    ])
  }

  async function handleUploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return
    setPhotoUploading(true)
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}/photos`, {
          method: "POST",
          body: formData,
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error ?? "上传失败")
        if (payload.data?.id) setPhotoIds((current) => [...current, payload.data.id])
      } catch (error) {
        toast.error(`${file.name} 上传失败`, { description: error instanceof Error ? error.message : undefined })
      }
    }
    setPhotoUploading(false)
    event.target.value = ""
  }

  async function handleSubmit() {
    if (lines.length === 0) return toast.error("请至少保留一项工作明细")
    setSaving(true)
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(order.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          content,
          note,
          workLines: lines.map((line, index) => ({ ...line, sortOrder: index })),
          actualQuantities: order.items.map((item) => ({
            itemId: item.id,
            actualQuantity: actualQuantities[item.id] ?? item.quantity,
          })),
          photoIds,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? "提交失败")
      onCompleted(payload.data)
      toast.success(`工单完成，合计 ${formatCents(payload.data.finalFeeCents)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>完成工单 · {order.code}</DialogTitle>
          <DialogDescription>
            已按所选工单类型预填工作明细，工程师按实际情况调整数量/单价/备注后提交。
          </DialogDescription>
        </DialogHeader>

        {loadingDraft ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在生成草稿…
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 text-sm">
              <Field>
                <FieldLabel>完成内容</FieldLabel>
                <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} />
              </Field>

              <FieldSet>
                <FieldLabel>实际数量（携带产品）</FieldLabel>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs [white-space:normal] break-words">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-2 font-medium">产品</th>
                        <th className="p-2 font-medium text-right">报价数量</th>
                        <th className="p-2 font-medium text-right">实际数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td className="p-2">
                            <div className="font-medium">{item.name}</div>
                            <div className="text-muted-foreground">{item.room ?? "—"}</div>
                          </td>
                          <td className="p-2 text-right">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="p-2 text-right">
                            <Input
                              type="number"
                              step="0.01"
                              className="ml-auto h-8 w-24 text-right"
                              value={actualQuantities[item.id] ?? item.quantity}
                              onChange={(event) =>
                                setActualQuantities((current) => ({
                                  ...current,
                                  [item.id]: Number(event.target.value),
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FieldSet>

              <FieldSet>
                <div className="flex items-center justify-between">
                  <FieldLabel>工作明细与计价</FieldLabel>
                  <Button type="button" size="sm" variant="outline" onClick={addBlankLine}>
                    <Plus className="size-4" />
                    加临时行
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs [white-space:normal] break-words">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-2 font-medium">项目</th>
                        <th className="p-2 font-medium">计价</th>
                        <th className="p-2 font-medium text-right">数量</th>
                        <th className="p-2 font-medium text-right">单价(元)</th>
                        <th className="p-2 font-medium text-right">小计</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.map((line, index) => {
                        const lineTotal = computeLineTotal(line.pricingMode, line.quantity, line.unitPriceCents, order.items.length)
                        return (
                          <tr key={index}>
                            <td className="p-2">
                              <Input
                                value={line.name}
                                onChange={(event) => updateLine(index, { name: event.target.value })}
                                className="h-8"
                              />
                            </td>
                            <td className="p-2">
                              <Select
                                value={line.pricingMode}
                                onValueChange={(value) => updateLine(index, { pricingMode: value as WorkPricingMode })}
                              >
                                <SelectTrigger className="h-8 w-28">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="fixed">固定</SelectItem>
                                  <SelectItem value="per_unit">按数量</SelectItem>
                                  <SelectItem value="per_product">按产品</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                step="0.01"
                                className="h-8 w-20 text-right"
                                value={line.quantity}
                                onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })}
                                disabled={line.pricingMode !== "per_unit"}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                step="1"
                                className="h-8 w-24 text-right"
                                value={line.unitPriceCents}
                                onChange={(event) => updateLine(index, { unitPriceCents: Number(event.target.value) })}
                                title="单位：分"
                              />
                            </td>
                            <td className="p-2 text-right font-medium">{formatCents(lineTotal)}</td>
                            <td className="p-2">
                              <Button size="icon" variant="ghost" onClick={() => removeLine(index)} type="button">
                                <Trash2 className="size-4" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-medium">
                        <td className="p-2" colSpan={4}>
                          合计
                        </td>
                        <td className="p-2 text-right">{formatCents(totalFeeCents)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </FieldSet>

              <Field>
                <FieldLabel>备注</FieldLabel>
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="如客户临时要求、二次上门原因等" />
              </Field>

              <FieldSet>
                <FieldLabel>现场照片（可选）</FieldLabel>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}>
                    {photoUploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                    上传照片
                  </Button>
                  <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={handleUploadPhoto} />
                  {photoIds.length > 0 ? (
                    <span className="text-xs text-muted-foreground">已上传 {photoIds.length} 张</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">可不上传</span>
                  )}
                </div>
              </FieldSet>
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving || loadingDraft}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            提交并完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkPricingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [entries, setEntries] = React.useState<WorkPricingCatalogEntry[]>([])
  const [filterType, setFilterType] = React.useState<string>("all")
  const [loading, setLoading] = React.useState(false)
  const [savingCode, setSavingCode] = React.useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/work-pricing")
      const payload = await res.json()
      setEntries(payload.data ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载计价失败")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load()
  }, [open])

  const filtered = filterType === "all" ? entries : entries.filter((entry) => entry.workType === filterType)

  async function saveOverride(entry: WorkPricingCatalogEntry) {
    setSavingCode(entry.code)
    try {
      const res = await fetch("/api/work-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "override",
          catalogCode: entry.code,
          name: entry.name,
          pricingMode: entry.pricingMode,
          unitPriceCents: entry.unitPriceCents,
          unitName: entry.unitName,
        }),
      })
      if (!res.ok) {
        const payload = await res.json()
        throw new Error(payload.error ?? "保存失败")
      }
      toast.success(`已保存「${entry.name}」的公司定价`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSavingCode(null)
    }
  }

  function updateEntry(code: string, patch: Partial<WorkPricingCatalogEntry>) {
    setEntries((current) => current.map((entry) => (entry.code === code ? { ...entry, ...patch } : entry)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>配置计价</DialogTitle>
          <DialogDescription>主账号可为每条标准工作条目覆盖单价/计价方式，也可新增本公司专属条目。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-2">
              {filtered.map((entry) => (
                <div key={entry.code} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {entry.name}
                        {entry.isSystem ? (
                          <Badge variant="outline" className="ml-2 font-normal text-xs">
                            标准
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="ml-2 font-normal text-xs">
                            自定义
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {WORK_ORDER_TYPE_LABELS[entry.workType]} · {entry.code}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveOverride(entry)}
                      disabled={savingCode === entry.code}
                    >
                      {savingCode === entry.code ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      保存
                    </Button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_120px_100px]">
                    <Input
                      value={entry.name}
                      onChange={(event) => updateEntry(entry.code, { name: event.target.value })}
                      className="h-8"
                    />
                    <Select
                      value={entry.pricingMode}
                      onValueChange={(value) => updateEntry(entry.code, { pricingMode: value as WorkPricingMode })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">固定</SelectItem>
                        <SelectItem value="per_unit">按数量</SelectItem>
                        <SelectItem value="per_product">按产品</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      className="h-8 text-right"
                      value={entry.unitPriceCents}
                      onChange={(event) => updateEntry(entry.code, { unitPriceCents: Number(event.target.value) })}
                      title="单位：分"
                    />
                    <Input
                      value={entry.unitName}
                      onChange={(event) => updateEntry(entry.code, { unitName: event.target.value })}
                      className="h-8"
                      placeholder="单位"
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <AddCustomPricingSection onSaved={load} />
      </DialogContent>
    </Dialog>
  )
}

function AddCustomPricingSection({ onSaved }: { onSaved: () => void }) {
  const [workType, setWorkType] = React.useState<WorkOrderType>("measure")
  const [name, setName] = React.useState("")
  const [pricingMode, setPricingMode] = React.useState<WorkPricingMode>("fixed")
  const [unitPriceCents, setUnitPriceCents] = React.useState(0)
  const [unitName, setUnitName] = React.useState("次")
  const [saving, setSaving] = React.useState(false)

  async function submit() {
    if (!name.trim()) return toast.error("请填写条目名称")
    setSaving(true)
    try {
      const res = await fetch("/api/work-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          workType,
          name,
          pricingMode,
          unitPriceCents,
          unitName,
        }),
      })
      if (!res.ok) {
        const payload = await res.json()
        throw new Error(payload.error ?? "新增失败")
      }
      toast.success(`已新增自定义条目「${name}」`)
      setName("")
      setUnitPriceCents(0)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldSet className="mt-4 border-t pt-4">
      <FieldLabel>新增本公司专属条目</FieldLabel>
      <FieldContent className="grid gap-2 sm:grid-cols-[120px_1fr_120px_120px_100px_auto]">
        <Select value={workType} onValueChange={(value) => setWorkType(value as WorkOrderType)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="工作条目名称"
          className="h-8"
        />
        <Select value={pricingMode} onValueChange={(value) => setPricingMode(value as WorkPricingMode)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">固定</SelectItem>
            <SelectItem value="per_unit">按数量</SelectItem>
            <SelectItem value="per_product">按产品</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          className="h-8 text-right"
          value={unitPriceCents}
          onChange={(event) => setUnitPriceCents(Number(event.target.value))}
          title="单位：分"
        />
        <Input
          value={unitName}
          onChange={(event) => setUnitName(event.target.value)}
          className="h-8"
          placeholder="单位"
        />
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          新增
        </Button>
      </FieldContent>
    </FieldSet>
  )
}
