"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  CalendarClock,
  Clock3,
  Edit3,
  Eye,
  History,
  MoreHorizontal,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { AdminDataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { SummaryField } from "@/components/business/summary-tile"

/** 售后维护任务。数据源尚未接入，保持空列表并渲染明确空态。 */
type MaintenanceTask = {
  customer: string
  id: string
  priority: "low" | "medium" | "high"
  risk: string
  scheduledAt: string
  status: "blocked" | "canceled" | "dispatching" | "done" | "in-progress" | "pending-location" | "scheduled"
  title: string
}

const statusLabels: Record<MaintenanceTask["status"], string> = {
  blocked: "需处理",
  canceled: "已取消",
  dispatching: "待派工",
  done: "已完成",
  "in-progress": "处理中",
  "pending-location": "待定位",
  scheduled: "已预约",
}

const priorityLabels: Record<MaintenanceTask["priority"], string> = {
  high: "紧急",
  low: "普通",
  medium: "优先",
}

const priorityTone: Record<MaintenanceTask["priority"], string> = {
  high: "border-red-200 bg-red-50 text-red-700",
  low: "border-muted bg-muted text-muted-foreground",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
}

type AftercareRecord = {
  createdAt: string
  customer: string
  due: string
  id: string
  owner: string
  project: string
  status: string
  title: string
  type: string
}

const aftercareRecords: AftercareRecord[] = []

const timeline: Array<{ note: string; time: string; title: string }> = []

const maintenanceTasks: MaintenanceTask[] = []

export function AftercareWorkbench() {
  const [query, setQuery] = React.useState("")
  const [records, setRecords] = React.useState(aftercareRecords)
  const [previewRecordId, setPreviewRecordId] = React.useState("")
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false)
  const aftercareTasks = maintenanceTasks
  const visibleRecords = records.filter((record) => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return true

    return [record.id, record.customer, record.project, record.title, record.type, record.owner, record.status]
      .join(" ")
      .toLowerCase()
      .includes(keyword)
  })
  const previewRecord = records.find((record) => record.id === previewRecordId) ?? null
  const aftercareColumns = React.useMemo(
    () =>
      createAftercareColumns((record) => {
        setPreviewRecordId(record.id)
        setIsPreviewOpen(true)
      }),
    []
  )

  function scheduleFollowUp() {
    const nextRecord = {
      createdAt: new Date().toISOString(),
      customer: "待确认客户",
      due: "明天 10:00",
      id: `AF-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(records.length + 1).padStart(3, "0")}`,
      owner: "待分配",
      project: "待关联项目",
      status: "已预约",
      title: "客户回访",
      type: "交付回访",
    }

    setRecords((current) => [nextRecord, ...current])
    setPreviewRecordId(nextRecord.id)
    setIsPreviewOpen(true)
    toast.success("已安排回访")
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="h-6 gap-1.5 rounded-md">
            <ShieldCheck className="size-3.5" />
            售后服务
          </Badge>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">售后工作台</h1>
        </div>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索客户、项目、售后记录"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>售后记录</CardTitle>
                <CardDescription>{visibleRecords.length} 条匹配记录</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={scheduleFollowUp}>
                <CalendarClock className="size-4" />
                安排回访
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={aftercareColumns}
              data={visibleRecords}
              emptyText="没有匹配售后记录"
              getRowId={(record) => record.id}
              globalFilterFn={(record, value) =>
                [record.id, record.customer, record.project, record.title, record.type, record.owner, record.status]
                  .join(" ")
                  .toLowerCase()
                  .includes(value.toLowerCase())
              }
              searchPlaceholder="筛选售后记录..."
            />
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 className="size-4 text-muted-foreground" />
                售后工单
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {aftercareTasks.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  暂无售后工单，维护任务的真实数据源尚未接入
                </p>
              ) : null}
              {aftercareTasks.map((task) => (
                <div key={task.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge className={cn("rounded-md border", priorityTone[task.priority])}>{priorityLabels[task.priority]}</Badge>
                    <span className="text-xs text-muted-foreground">{statusLabels[task.status]}</span>
                  </div>
                  <div className="mt-3 text-sm font-medium">{task.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.customer} / {task.scheduledAt}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{task.risk}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4 text-muted-foreground" />
                今日动态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {timeline.map((item) => (
                <div key={`${item.time}-${item.title}`} className="grid grid-cols-[52px_1fr] gap-3 rounded-lg border p-3">
                  <div className="text-sm font-semibold">{item.time}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.note}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="text-start">
            <SheetTitle>售后预览</SheetTitle>
            <SheetDescription>
              {previewRecord ? `${previewRecord.project} / ${previewRecord.customer}` : "查看售后详情"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            {previewRecord ? <AftercarePreview record={previewRecord} /> : null}
          </div>
          <SheetFooter className="gap-2">
            {previewRecord ? (
              <Button asChild>
                <a href={`/projects?tab=aftercare&aftercare=${encodeURIComponent(previewRecord.id)}`}>
                  <Edit3 className="size-4" />
                  进入项目内编辑
                </a>
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}

function createAftercareColumns(onPreview: (record: AftercareRecord) => void): ColumnDef<AftercareRecord>[] {
  return [
    {
      accessorKey: "title",
      header: "记录",
      cell: ({ row }) => (
        <div className="min-w-64">
          <div className="font-semibold">{row.original.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{row.original.id}</div>
        </div>
      ),
    },
    {
      accessorKey: "project",
      header: "项目/客户",
      cell: ({ row }) => (
        <div className="min-w-44">
          <div className="font-medium">{row.original.project}</div>
          <div className="mt-1 text-xs text-muted-foreground">{row.original.customer}</div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="rounded-md">
            {row.original.type}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {row.original.status}
          </Badge>
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "创建时间",
      cell: ({ row }) => (
        <div className="text-muted-foreground">{formatDate(row.original.createdAt)}</div>
      ),
    },
    {
      accessorKey: "owner",
      header: "负责人",
      cell: ({ row }) => (
        <div>
          <div className="inline-flex items-center gap-1 font-medium">
            <UserRound className="size-3.5 text-muted-foreground" />
            {row.original.owner}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{row.original.due}</div>
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => <AftercareActions record={row.original} onPreview={onPreview} />,
    },
  ]
}

function AftercareActions({
  onPreview,
  record,
}: {
  onPreview: (record: AftercareRecord) => void
  record: AftercareRecord
}) {
  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 p-0 text-muted-foreground data-[state=open]:bg-muted" aria-label="打开售后操作">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onPreview(record)}>
            <Eye className="size-4" />
            预览
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/projects?tab=aftercare&aftercare=${encodeURIComponent(record.id)}`}>
              <Edit3 className="size-4" />
              进入项目内编辑
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AftercarePreview({ record }: { record: AftercareRecord }) {
  return (
    <div className="space-y-6 pb-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md">
            {record.id}
          </Badge>
          <Badge variant="secondary" className="rounded-md">
            {record.type}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {record.status}
          </Badge>
        </div>
        <h2 className="text-base font-semibold leading-6">{record.title}</h2>
        <p className="text-sm text-muted-foreground">
          {record.project} / {record.customer}
        </p>
      </div>

      <div className="grid gap-3 text-sm">
        <SummaryField label="类型" value={record.type} />
        <SummaryField label="负责人" value={record.owner} />
        <SummaryField label="创建时间" value={formatDate(record.createdAt)} />
        <SummaryField label="计划时间" value={record.due} />
      </div>
    </div>
  )
}

function formatDate(value: string | undefined) {
  if (!value) return "-"

  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) return "-"

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}
