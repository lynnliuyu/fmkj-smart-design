"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Check,
  CheckCircle2,
  FileText,
  FolderKanban,
  Images,
  Loader2,
  MapPinned,
  MoreHorizontal,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectAccessPayload } from "@/lib/project-member-access-service"
import {
  WORKBENCH_BASIC_TAB,
  legacyWorkspaceTabHref,
  normalizeWorkspaceTab,
  pageOwnedWorkspaceTabs,
  type WorkbenchWorkspaceTab,
} from "@/lib/workbench-nav"
import { updateProjectDetailsClient } from "@/lib/project-workflow-client"
import type { ProjectWaitingOn } from "@/lib/project-workbench"
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

/** 段落取值到图标的映射；取值与文案由 workbench-nav 统一维护。 */
const workspaceTabIcons: Record<WorkbenchWorkspaceTab, LucideIcon> = {
  "basic": UserRound,
  "solution-quote": MapPinned,
  "members": Users,
}

/** 执行类业务不再占用项目内段落，直接在「执行与资料」里跳到各自的页面。 */
const stageLinks: Array<{ label: string; icon: LucideIcon; href: (projectId: string) => string }> = [
  { label: "客户交付", icon: CheckCircle2, href: (projectId) => `/projects/${encodeURIComponent(projectId)}/presentation` },
]

/**
 * 顶部栏已经承担「项目（资料）/ 方案报价」两个主入口，
 * 页内只保留「执行与资料」里按需打开的次要段落，避免两套重复入口。
 */
const secondaryTabs = pageOwnedWorkspaceTabs()

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const requestedTab = searchParams.get("tab")
  const routeTab = normalizeWorkspaceTab(requestedTab)
  const [tabSelection, setTabSelection] = React.useState({ routeTab, value: routeTab })
  const activeTab = tabSelection.routeTab === routeTab ? tabSelection.value : routeTab
  const activeSecondaryTab = secondaryTabs.find((tab) => tab.value === activeTab)
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

  // 合同 / 交付不再是项目内段落：旧直达地址转到对应业务页面，避免静默变成「资料」。
  React.useEffect(() => {
    const legacyHref = legacyWorkspaceTabHref(requestedTab, projectId)
    if (legacyHref) router.replace(legacyHref)
  }, [projectId, requestedTab, router])

  // 段落写回地址：刷新页面，或从顶部栏切回主入口时，仍落在同一段。
  function selectTab(value: WorkbenchWorkspaceTab) {
    setTabSelection({ routeTab, value })
    const params = new URLSearchParams(searchParams.toString())
    if (value === WORKBENCH_BASIC_TAB) params.delete("tab")
    else params.set("tab", value)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

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
      <ProjectOverviewCard
        activeSecondaryTab={activeSecondaryTab?.value ?? null}
        onSaved={(updatedProject) => setProject(updatedProject)}
        onSelectSecondaryTab={selectTab}
        options={options}
        project={project}
        showBasicDetails={activeTab === WORKBENCH_BASIC_TAB}
      />

      {activeTab === "solution-quote" ? <SolutionQuotePanel project={project} /> : null}
      {activeTab === "members" ? <ProjectMembersPanel projectId={project.id} /> : null}
    </section>
  )
}

function ProjectOverviewCard({
  activeSecondaryTab,
  onSaved,
  onSelectSecondaryTab,
  options,
  project,
  showBasicDetails,
}: {
  activeSecondaryTab: WorkbenchWorkspaceTab | null
  onSaved: (project: Project) => void
  onSelectSecondaryTab: (value: WorkbenchWorkspaceTab) => void
  options: ProjectOptions
  project: Project
  showBasicDetails: boolean
}) {
  const risk = project.riskLevel ?? project.risk
  const [isEditing, setIsEditing] = React.useState(false)

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{stageLabels[project.stage] ?? project.stage}</Badge>
              {project.stageStatusLabel ? <Badge variant="secondary">{project.stageStatusLabel}</Badge> : null}
              {/* 「正常」是默认值，不占位；只有需关注 / 阻塞才显示。 */}
              {risk !== "normal" ? (
                <Badge variant={risk === "blocked" ? "destructive" : "secondary"}>{riskLabel(risk)}</Badge>
              ) : null}
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
            {showBasicDetails ? (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Pencil className="size-4" />
                编辑资料
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal className="size-4" />
                  执行与资料
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {stageLinks.map((stage) => {
                  const Icon = stage.icon

                  return (
                    <DropdownMenuItem key={stage.label} asChild>
                      <Link href={stage.href(project.id)}>
                        <Icon className="size-4" />
                        {stage.label}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                {secondaryTabs.map((tab) => {
                  const Icon = workspaceTabIcons[tab.value]

                  return (
                    <DropdownMenuItem key={tab.value} onSelect={() => onSelectSecondaryTab(tab.value)}>
                      <Icon className="size-4" />
                      {tab.label}
                      {tab.value === activeSecondaryTab ? <Check className="ml-auto size-4" /> : null}
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/projects">
                    <FolderKanban className="size-4" />
                    返回项目列表
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      {showBasicDetails ? (
        <CardContent className="grid gap-3">
          <div className="text-xs font-medium text-muted-foreground">基础资料</div>
          <ProjectDetailsSummary project={project} />
        </CardContent>
      ) : null}

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑基础资料</DialogTitle>
            <DialogDescription>保存后立即写入项目；取消不会改动已有资料。</DialogDescription>
          </DialogHeader>
          {/* 只在弹窗打开时挂载，重新打开会读取最新的项目资料。 */}
          {isEditing ? (
            <ProjectDetailsForm
              onCancel={() => setIsEditing(false)}
              onSaved={(updatedProject) => {
                onSaved(updatedProject)
                setIsEditing(false)
              }}
              options={options}
              project={project}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

type ProjectDetailRow = {
  label: string
  value: string | null | undefined
  wide?: boolean
}

function ProjectDetailsSummary({ project }: { project: Project }) {
  const risk = project.riskLevel ?? project.risk
  const rows: ProjectDetailRow[] = [
    // 项目名已经在卡片标题上，这里不再重复。
    { label: "客户姓名", value: project.customer },
    { label: "联系电话", value: project.phone },
    { label: "小区名", value: project.community },
    { label: "楼栋", value: project.building },
    { label: "房号", value: project.roomNo },
    { label: "地址", value: project.address },
    { label: "负责人", value: project.owner },
    { label: "系统平台", value: project.platform },
    { label: "下一步截止", value: formatDateInput(project.nextActionDueAt) },
    { label: "下一步负责人", value: project.nextActionOwnerName || project.owner },
    { label: "等待对象", value: waitingOnLabel(project.waitingOn) },
    { label: "下一步", value: project.nextAction, wide: true },
    { label: "风险原因", value: project.riskReason || (risk === "normal" ? "暂无风险" : "待补充原因"), wide: true },
    { label: "截止说明", value: project.dueNote, wide: true },
  ]

  return (
    <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className={row.wide ? "grid gap-1 md:col-span-2" : "grid gap-1"}>
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="text-sm break-words">{row.value?.trim() ? row.value : "-"}</dd>
        </div>
      ))}
    </dl>
  )
}

function ProjectDetailsForm({
  onCancel,
  onSaved,
  options,
  project,
}: {
  onCancel: () => void
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
    <form action={saveProject} className="grid gap-5">
      <div className="grid max-h-[55vh] gap-3 overflow-y-auto pe-1 md:grid-cols-2">
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
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="nextAction">下一步</Label>
          <Textarea id="nextAction" name="nextAction" defaultValue={project.nextAction} placeholder="填写下一步动作" />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="dueNote">截止说明</Label>
          <Input id="dueNote" name="dueNote" defaultValue={project.dueNote} placeholder="待补充下一步时间" />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存修改
        </Button>
      </DialogFooter>
    </form>
  )
}

function SolutionQuotePanel({ project }: { project: Project }) {
  const [quickOpen, setQuickOpen] = React.useState(false)

  return (
    <>
      <Card>
        <CardHeader>
          <CardAction>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setQuickOpen(true)}>
                <Sparkles className="size-4" />
                快速报价
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/quotes?projectId=${encodeURIComponent(project.id)}`}>
                  <FileText className="size-4" />
                  打开报价单
                </Link>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ProjectSavedDesignSummary projectId={project.id} />
        </CardContent>
      </Card>

      <QuickQuoteDialog projectId={project.id} open={quickOpen} onOpenChange={setQuickOpen} />
    </>
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

function formatDateInput(value: Project["nextActionDueAt"]) {
  if (!value) return ""

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""

  return date.toISOString().slice(0, 10)
}
