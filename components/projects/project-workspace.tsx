"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Headset,
  Home,
  Images,
  Loader2,
  MapPinned,
  MoreHorizontal,
  Phone,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { SummaryTile } from "@/components/business/summary-tile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectAccessPayload } from "@/lib/project-member-access-service"
import { updateProjectDetailsClient } from "@/lib/project-workflow-client"
import type { ProjectWaitingOn } from "@/lib/project-workbench"
import { ProjectSitePhotosPanel } from "@/components/projects/project-site-photos"
import { ProjectSavedDesignSummary } from "@/components/projects/project-saved-design-summary"
import { QuickQuoteDialog } from "@/components/quotes/quick-quote-dialog"

type Project = {
  id: string
  name: string
  code: string
  customer: string
  phone: string
  community: string
  building: string
  roomNo: string
  address: string
  platform: string
  owner: string
  designer: string
  budget: number
  quoteAmount: number | null
  stage: string
  stageStatusLabel?: string | null
  risk: "normal" | "watch" | "blocked"
  riskLevel?: "normal" | "watch" | "blocked"
  riskReason?: string
  dueNote: string
  nextAction: string
  nextActionDueAt?: string | null
  nextActionOwnerName?: string | null
  waitingOn?: ProjectWaitingOn
  tags: string[]
}

type ProjectsResponse = {
  data?: Project[]
}

type ProjectOption = {
  label: string
  value: string
}

type ProjectOptions = {
  communities?: Array<ProjectOption & { projectCount?: number }>
  owners?: ProjectOption[]
  platforms?: ProjectOption[]
}

type ProjectOptionsResponse = {
  data?: ProjectOptions
}

const stageLabels: Record<string, string> = {
  acceptance: "交付验收",
  aftercare: "售后维护",
  contract: "合同收款",
  install: "安装调试",
  measure: "现场测量",
  new: "新建跟进",
  proposal: "方案报价",
}

const workspaceTabs = [
  { value: "basic", label: "资料", icon: UserRound },
  { value: "solution-quote", label: "方案报价", icon: MapPinned },
  { value: "contract", label: "合同", icon: FileCheck2 },
  { value: "work-orders", label: "工单", icon: ClipboardCheck },
  { value: "delivery", label: "交付", icon: CheckCircle2 },
  { value: "aftercare", label: "售后", icon: Headset },
  { value: "members", label: "成员", icon: Users },
  { value: "site-photos", label: "现场图片", icon: Images },
]

const workspaceTabValues = new Set(workspaceTabs.map((tab) => tab.value))

function normalizeWorkspaceTab(value: string | null) {
  if (value === "workOrder" || value === "work-orders") return "work-orders"
  if (value === "point-map" || value === "quote") return "solution-quote"
  if (value && workspaceTabValues.has(value)) return value
  return "basic"
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams()
  const initialTab = normalizeWorkspaceTab(searchParams.get("tab"))
  const [tabSelection, setTabSelection] = React.useState({ routeTab: initialTab, value: initialTab })
  const activeTab = tabSelection.routeTab === initialTab ? tabSelection.value : initialTab
  const secondaryTab = workspaceTabs.find((tab) => tab.value === activeTab && !["basic", "solution-quote"].includes(tab.value))
  const [project, setProject] = React.useState<Project | null>(null)
  const [options, setOptions] = React.useState<ProjectOptions>({})
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true

    async function loadProject() {
      setIsLoading(true)

      try {
        const [projectsResponse, optionsResponse] = await Promise.all([
          fetch("/api/projects", { cache: "no-store" }),
          fetch("/api/project-options", { cache: "no-store" }),
        ])
        const projectsPayload = (await projectsResponse.json()) as ProjectsResponse
        const optionsPayload = (await optionsResponse.json()) as ProjectOptionsResponse
        const nextProject = projectsPayload.data?.find((item) => item.id === projectId) ?? null

        if (active) {
          setProject(nextProject)
          setOptions(optionsPayload.data ?? {})
        }
      } catch {
        if (active) {
          setProject(null)
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadProject()

    return () => {
      active = false
    }
  }, [projectId])

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>项目未找到</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/projects">返回项目列表</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="flex flex-col gap-5">
      <ProjectCommandCenter project={project} />

      <Tabs value={activeTab} onValueChange={(value) => setTabSelection({ routeTab: initialTab, value })} className="gap-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start rounded-lg">
          {workspaceTabs.filter((tab) => ["basic", "solution-quote"].includes(tab.value)).map((tab) => {
            const Icon = tab.icon

            return (
              <TabsTrigger key={tab.value} value={tab.value} className="h-9 flex-none rounded-md px-3">
                <Icon className="size-4" />
                {tab.label}
              </TabsTrigger>
            )
          })}
          {secondaryTab ? <TabsTrigger value={secondaryTab.value} className="h-9 flex-none rounded-md px-3"><secondaryTab.icon className="size-4" />{secondaryTab.label}</TabsTrigger> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="ml-auto" aria-label="执行与项目资料">
                <MoreHorizontal className="size-4" />执行与资料
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {workspaceTabs.filter((tab) => !["basic", "solution-quote"].includes(tab.value)).map((tab) => {
                const Icon = tab.icon
                return <DropdownMenuItem key={tab.value} onSelect={() => setTabSelection({ routeTab: initialTab, value: tab.value })}><Icon className="size-4" />{tab.label}</DropdownMenuItem>
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </TabsList>

        <TabsContent value="basic">
          <ProjectDetailsForm
            options={options}
            project={project}
            onSaved={(updatedProject) => setProject(updatedProject)}
          />
        </TabsContent>
        <TabsContent value="solution-quote">
          <SolutionQuotePanel project={project} />
        </TabsContent>
        <TabsContent value="contract">
          <StagePanel
            title="合同"
            primaryHref={`/contracts?projectId=${encodeURIComponent(project.id)}`}
            primaryLabel="查看合同"
            items={["合同正文", "报价单附件", "点位图附件", "签约状态"]}
          />
        </TabsContent>
        <TabsContent value="work-orders">
          <StagePanel
            title="工单"
            primaryHref={`/work-orders?projectId=${encodeURIComponent(project.id)}`}
            primaryLabel="查看工单"
            items={["标准工作内容", "报价产品携带", "工地实拍", "企业版工价字段"]}
          />
        </TabsContent>
        <TabsContent value="delivery">
          <StagePanel
            title="客户交付与验收"
            primaryHref={`/projects/${encodeURIComponent(project.id)}/presentation`}
            primaryLabel="查看客户交付"
            items={["产品数量确认", "安装位置确认", "联网与控制测试", "客户签字/线上确认"]}
          />
        </TabsContent>
        <TabsContent value="aftercare">
          <StagePanel
            title="售后"
            primaryHref={`/aftercare?projectId=${encodeURIComponent(project.id)}`}
            primaryLabel="查看售后"
            items={["售后问题", "处理记录", "照片附件", "项目关联"]}
          />
        </TabsContent>
        <TabsContent value="members">
          <ProjectMembersPanel projectId={project.id} />
        </TabsContent>
        <TabsContent value="site-photos">
          <ProjectSitePhotosPanel projectId={project.id} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

function ProjectCommandCenter({ project }: { project: Project }) {
  const risk = project.riskLevel ?? project.risk

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{stageLabels[project.stage] ?? project.stage}</Badge>
              {project.stageStatusLabel ? <Badge variant="secondary">{project.stageStatusLabel}</Badge> : null}
              <Badge variant={risk === "blocked" ? "destructive" : risk === "watch" ? "secondary" : "outline"}>
                {riskLabel(risk)}
              </Badge>
            </div>
            <div>
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">{project.code}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/point-map?projectId=${encodeURIComponent(project.id)}`}>
                <MapPinned className="size-4" />
                继续方案报价
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/projects">返回项目列表</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile icon={UserRound} label="客户" value={project.customer || "-"} detail={project.phone || "-"} />
        <SummaryTile icon={Home} label="地址" value={project.address || "-"} detail={project.platform || "平台待定"} />
        <SummaryTile
          icon={ClipboardCheck}
          label="下一步"
          value={project.nextAction || "-"}
          detail={`负责人：${project.nextActionOwnerName || project.owner || "-"}`}
          className="xl:col-span-2"
        />
        <SummaryTile icon={CalendarClock} label="截止时间" value={formatDue(project.nextActionDueAt, project.dueNote)} />
        <SummaryTile icon={Phone} label="等待对象" value={waitingOnLabel(project.waitingOn)} />
        <SummaryTile
          icon={ShieldAlert}
          label="风险原因"
          value={project.riskReason || (risk === "normal" ? "暂无风险" : "待补充原因")}
          className="xl:col-span-2"
        />
      </CardContent>
    </Card>
  )
}

function ProjectDetailsForm({
  onSaved,
  options,
  project,
}: {
  onSaved: (project: Project) => void
  options: ProjectOptions
  project: Project
}) {
  const ownerOptions = ensureOption(options.owners ?? [], project.owner || "运营负责人")
  const nextOwnerOptions = ensureOption(ownerOptions, project.nextActionOwnerName || project.owner || "经理-老板")
  const platformOptions = ensureOption(options.platforms ?? [], project.platform || "待定")
  const communityOptions = ensureOption(options.communities ?? [], project.community)
  const [owner, setOwner] = React.useState(project.owner || ownerOptions[0]?.value || "运营负责人")
  const [nextOwner, setNextOwner] = React.useState(
    project.nextActionOwnerName || project.owner || nextOwnerOptions[0]?.value || "经理-老板",
  )
  const [platform, setPlatform] = React.useState(project.platform || platformOptions[0]?.value || "待定")
  const [isSaving, setIsSaving] = React.useState(false)

  async function saveProject(formData: FormData) {
    setIsSaving(true)

    try {
      const payload = Object.fromEntries(formData.entries())
      const updatedProject = await updateProjectDetailsClient<Project>(project.id, {
        ...payload,
        nextActionOwnerName: nextOwner,
        owner,
        platform,
      })

      onSaved(updatedProject)
      toast.success("项目已保存")
    } catch {
      toast.error("项目保存失败，请稍后再试")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>基础资料</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={saveProject} className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="项目名称" name="name" placeholder="项目名称" defaultValue={project.name} />
            <Field label="客户姓名" name="customer" placeholder="客户姓名" defaultValue={project.customer} />
            <Field label="联系电话" name="phone" placeholder="联系电话" defaultValue={project.phone} />
            <Field
              datalistId="project-detail-community-options"
              label="小区名"
              name="community"
              placeholder="选择或输入小区名"
              defaultValue={project.community}
            />
            <datalist id="project-detail-community-options">
              {communityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
            <Field label="楼栋" name="building" placeholder="楼栋" defaultValue={project.building} />
            <Field label="房号" name="roomNo" placeholder="房号" defaultValue={project.roomNo} />
            <SelectField label="负责人" value={owner} options={ownerOptions} onValueChange={setOwner} />
            <SelectField label="系统平台" value={platform} options={platformOptions} onValueChange={setPlatform} />
            <Field
              label="下一步截止"
              name="nextActionDueAt"
              placeholder="选择日期"
              type="date"
              defaultValue={formatDateInput(project.nextActionDueAt)}
            />
            <SelectField label="下一步负责人" value={nextOwner} options={nextOwnerOptions} onValueChange={setNextOwner} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nextAction">下一步</Label>
            <Textarea id="nextAction" name="nextAction" defaultValue={project.nextAction} placeholder="填写下一步动作" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dueNote">截止说明</Label>
            <Input id="dueNote" name="dueNote" defaultValue={project.dueNote} placeholder="待补充下一步时间" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存修改
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function SolutionQuotePanel({ project }: { project: Project }) {
  const [quickOpen, setQuickOpen] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>方案报价</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProjectSavedDesignSummary projectId={project.id} />
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/point-map?projectId=${encodeURIComponent(project.id)}`}>
              <MapPinned className="size-4" />
              打开草稿继续核对
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => setQuickOpen(true)}>
            <Sparkles className="size-4" />
            快速报价
          </Button>
          <Button asChild variant="outline">
            <Link href={`/quotes?projectId=${encodeURIComponent(project.id)}`}>
              <FileText className="size-4" />
              查看报价版本
            </Link>
          </Button>
        </div>
        <QuickQuoteDialog
          projectId={project.id}
          open={quickOpen}
          onOpenChange={setQuickOpen}
        />
      </CardContent>
    </Card>
  )
}

function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const [access, setAccess] = React.useState<ProjectAccessPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [message, setMessage] = React.useState("")

  React.useEffect(() => {
    let active = true

    async function loadAccess() {
      setIsLoading(true)
      setMessage("")

      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
          cache: "no-store",
        })
        const payload = (await response.json()) as { access?: ProjectAccessPayload; error?: string }

        if (!active) return

        if (!response.ok || !payload.access) {
          setMessage(payload.error ?? "项目成员授权暂不可用")
          setAccess(null)
          return
        }

        setAccess(payload.access)
      } catch {
        if (active) {
          setMessage("项目成员授权暂不可用")
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadAccess()

    return () => {
      active = false
    }
  }, [projectId])

  async function toggleMember(userId: string, granted: boolean) {
    if (!access?.canManage) return

    const previous = access
    setAccess({
      ...access,
      members: access.members.map((member) => (member.userId === userId ? { ...member, granted } : member)),
    })
    setMessage("")

    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
      body: JSON.stringify({ granted, userId }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
    const payload = (await response.json()) as { access?: ProjectAccessPayload; error?: string }

    if (!response.ok || !payload.access) {
      setAccess(previous)
      setMessage(payload.error ?? "项目成员授权更新失败")
      return
    }

    setAccess(payload.access)
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>项目成员授权</CardTitle>
          </div>
          <Badge variant={access?.canManage ? "default" : "secondary"}>
            <ShieldCheck className="size-3" />
            {access?.canManage ? "可管理" : "只读"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {message ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {message}
          </div>
        ) : null}
        {access && access.members.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {access.members.map((member) => (
              <label key={member.userId} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{member.name || member.email}</span>
                    <Badge variant="outline">{member.roleName}</Badge>
                    <Badge variant={member.status === "disabled" ? "secondary" : "outline"}>
                      {memberStatusLabel(member.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{member.email}</div>
                </div>
                <Checkbox
                  checked={member.granted}
                  disabled={!access.canManage || member.status === "disabled"}
                  onCheckedChange={(checked) => {
                    void toggleMember(member.userId, checked === true)
                  }}
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            这个项目暂无可授权的企业成员。
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function memberStatusLabel(status: ProjectAccessPayload["members"][number]["status"]) {
  if (status === "active") return "已启用"
  if (status === "invited") return "待启用"
  if (status === "disabled") return "已停用"
  return "已移除"
}

function StagePanel({
  items,
  primaryHref,
  primaryLabel,
  title,
}: {
  items: string[]
  primaryHref?: string
  primaryLabel?: string
  title: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((item) => (
            <div key={item} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
              {item}
            </div>
          ))}
        </div>
        {primaryHref && primaryLabel ? (
          <Button asChild>
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Field({
  datalistId,
  defaultValue,
  label,
  name,
  placeholder,
  type = "text",
}: {
  datalistId?: string
  defaultValue?: string
  label: string
  name: string
  placeholder: string
  type?: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} list={datalistId} name={name} placeholder={placeholder} type={type} defaultValue={defaultValue} />
    </div>
  )
}

function SelectField({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string
  onValueChange: (value: string) => void
  options: ProjectOption[]
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9 w-full rounded-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ensureOption(options: ProjectOption[], currentValue: string | null | undefined) {
  const seen = new Set<string>()
  const values = [...options]
  const value = currentValue?.trim()

  if (value && !values.some((option) => option.value === value)) {
    values.unshift({ label: value, value })
  }

  return values.filter((option) => {
    const optionValue = option.value.trim()
    if (!optionValue || seen.has(optionValue)) return false
    seen.add(optionValue)
    return true
  })
}

function riskLabel(risk: Project["risk"]) {
  if (risk === "blocked") return "阻塞"
  if (risk === "watch") return "需关注"
  return "正常"
}

function waitingOnLabel(waitingOn: Project["waitingOn"]) {
  if (waitingOn === "customer") return "客户"
  if (waitingOn === "internal") return "内部团队"
  if (waitingOn === "vendor") return "供应商"
  return "无等待"
}

function formatDue(value: Project["nextActionDueAt"], fallback: string) {
  if (!value) {
    return fallback || "未设截止"
  }

  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) {
    return fallback || "未设截止"
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
  }).format(date)
}

function formatDateInput(value: Project["nextActionDueAt"]) {
  if (!value) return ""

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""

  return date.toISOString().slice(0, 10)
}
