"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import {
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileText,
  FolderKanban,
  Hammer,
  HeartHandshake,
  Home,
  Loader2,
  MapPinned,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"

import { AdminDataTable } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  createProjectClient,
  listProjectsClient,
  ProjectWorkflowClientError,
} from "@/lib/project-workflow-client"
import { groupProjectWorkbenchProjects } from "@/lib/project-workbench"
import type { ProjectWaitingOn } from "@/lib/project-workbench"
import { cn } from "@/lib/utils"

type StageKey = "new" | "measure" | "proposal" | "contract" | "install" | "acceptance" | "aftercare"
type Risk = "normal" | "watch" | "blocked"

type Stage = {
  key: StageKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  progress: number
  deliverables: string[]
}

type Project = {
  id: string
  name: string
  code: string
  customer: string
  phone: string
  address: string
  platform: string
  owner: string
  designer: string
  budget: number
  quoteAmount: number | null
  stage: StageKey
  stageStatusLabel?: string | null
  risk: Risk
  riskLevel?: Risk
  riskReason?: string
  dueNote: string
  nextAction: string
  nextActionDueAt?: string | null
  nextActionOwnerName?: string | null
  createdAt?: string
  updatedAt?: string
  waitingOn?: ProjectWaitingOn
  tags: string[]
}

type ProjectOption = {
  label: string
  value: string
}

type ProjectOptionsResponse = {
  data?: {
    communities?: Array<ProjectOption & { projectCount?: number }>
    owners?: ProjectOption[]
    platforms?: ProjectOption[]
  }
}

const text = {
  title: "项目",
  subtitle: "按风险、到期和等待状态安排今天要推进的项目。",
  total: "项目总数",
  active: "进行中",
  upcoming: "近期到期",
  risks: "风险/阻塞",
  waiting: "等待中",
  workbench: "项目运营工作台",
  search: "搜索项目、客户、小区、负责人",
  currentStage: "当前阶段",
  empty: "暂无匹配项目",
  create: "新建项目",
  projectName: "项目名称",
  customer: "客户姓名",
  phone: "联系电话",
  community: "小区名",
  building: "楼栋",
  unitNo: "单元",
  roomNo: "房号",
  address: "项目地址",
  platform: "平台系统",
  budget: "预算",
  quote: "报价",
  waitingQuote: "待生成",
  enterQuote: "进入方案报价",
  enterWorkspace: "进入项目工作台",
  nextAction: "下一步动作",
  advance: "推进到下一阶段",
  markRisk: "标记风险",
  clearRisk: "解除风险",
  attachments: "项目附件",
  uploadContract: "上传合同",
  uploadFloorplan: "上传户型图",
  uploadQuotePdf: "上传报价 PDF",
  deliverables: "阶段交付物",
  actions: "动作中心",
  normal: "正常",
  watch: "需关注",
  blocked: "阻塞",
}

const stages: Stage[] = [
  {
    key: "new",
    label: "\u65b0\u5efa\u8ddf\u8fdb",
    icon: ClipboardList,
    progress: 5,
    deliverables: ["\u5ba2\u6237\u4fe1\u606f", "\u6237\u578b\u8d44\u6599", "\u9884\u7b97\u8303\u56f4", "\u9700\u6c42\u8bb0\u5f55"],
  },
  {
    key: "measure",
    label: "\u73b0\u573a\u6d4b\u91cf",
    icon: Home,
    progress: 14,
    deliverables: ["\u73b0\u573a\u5c3a\u5bf8", "\u7f51\u7edc\u70b9\u4f4d", "\u5b89\u88c5\u6761\u4ef6", "\u6d4b\u91cf\u8bb0\u5f55"],
  },
  {
    key: "proposal",
    label: "\u65b9\u6848\u62a5\u4ef7",
    icon: FileText,
    progress: 28,
    deliverables: ["\u5ba2\u6237\u9700\u6c42", "\u70b9\u4f4d\u6e05\u5355", "\u4ea7\u54c1\u9009\u578b", "\u62a5\u4ef7\u8349\u7a3f"],
  },
  {
    key: "contract",
    label: "\u5408\u540c\u6536\u6b3e",
    icon: FileCheck2,
    progress: 48,
    deliverables: ["\u786e\u8ba4\u62a5\u4ef7", "\u5408\u540c\u8349\u7a3f", "\u6536\u6b3e\u8282\u70b9", "\u7b7e\u7ea6\u8bb0\u5f55"],
  },
  {
    key: "install",
    label: "\u5b89\u88c5\u8c03\u8bd5",
    icon: Hammer,
    progress: 68,
    deliverables: ["\u65bd\u5de5\u5de5\u5355", "\u8bbe\u5907\u5230\u8d27", "\u73b0\u573a\u53d8\u66f4", "\u8c03\u8bd5\u8bb0\u5f55"],
  },
  {
    key: "acceptance",
    label: "\u4ea4\u4ed8\u9a8c\u6536",
    icon: CheckCircle2,
    progress: 88,
    deliverables: ["\u9a8c\u6536\u6e05\u5355", "\u4ea4\u4ed8\u8d44\u6599", "\u5ba2\u6237\u7b7e\u6536", "\u589e\u8865\u786e\u8ba4"],
  },
  {
    key: "aftercare",
    label: "\u552e\u540e\u7ef4\u62a4",
    icon: HeartHandshake,
    progress: 100,
    deliverables: ["\u56de\u8bbf\u8bb0\u5f55", "\u552e\u540e\u5de5\u5355", "\u4fdd\u4fee\u8d44\u6599", "\u590d\u8d2d\u7ebf\u7d22"],
  },
]

const initialProjects: Project[] = []

export function ProjectFlow() {
  const [projects, setProjects] = React.useState(initialProjects)
  const [projectOptions, setProjectOptions] = React.useState<ProjectOptionsResponse["data"]>({
    communities: [],
    owners: [],
    platforms: [],
  })
  const [query, setQuery] = React.useState("")
  const [createError, setCreateError] = React.useState("")
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [hasLoadedProjectOptions, setHasLoadedProjectOptions] = React.useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = React.useState(true)
  const [projectLoadError, setProjectLoadError] = React.useState("")
  const [projectLoadAttempt, setProjectLoadAttempt] = React.useState(0)

  React.useEffect(() => {
    let active = true

    async function loadProjects() {
      setIsLoadingProjects(true)
      setProjectLoadError("")
      try {
        const nextProjects = (await listProjectsClient<Project>()).filter(isProject)

        if (active) {
          setProjects(nextProjects)
        }
      } catch (error) {
        if (!active) return
        setProjectLoadError(
          error instanceof ProjectWorkflowClientError && error.status === 401
            ? "登录已失效，请重新登录后重试。"
            : error instanceof ProjectWorkflowClientError && error.status === 403
              ? "当前账号没有读取项目列表的权限，请核对登录账号。"
              : "项目列表读取失败，请确认工作站服务已启动后重试。",
        )
      } finally {
        if (active) setIsLoadingProjects(false)
      }
    }

    void loadProjects()

    return () => {
      active = false
    }
  }, [projectLoadAttempt])

  async function loadProjectOptions() {
    if (hasLoadedProjectOptions) return

    try {
      const response = await fetch("/api/project-options", { cache: "no-store" })
      const payload = (await response.json()) as ProjectOptionsResponse

      if (payload.data) {
        setProjectOptions(payload.data)
        setHasLoadedProjectOptions(true)
      }
    } catch {
      // Fall back to local defaults in the create dialog.
    }
  }

  const filteredProjects = projects.filter((project) => {
    const haystack = [
      project.name,
      project.code,
      project.customer,
      project.address,
      project.platform,
      project.owner,
      project.nextActionOwnerName,
      project.designer,
      ...project.tags,
    ]
      .join(" ")
      .toLowerCase()

    return haystack.includes(query.trim().toLowerCase())
  })
  const groupedProjects = groupProjectWorkbenchProjects(
    filteredProjects.map((project) => ({
      ...project,
      riskLevel: project.riskLevel ?? project.risk,
      waitingOn: project.waitingOn ?? "none",
    })),
  )

  async function createProject(formData: FormData) {
    const input = Object.fromEntries(formData.entries())
    setCreateError("")
    setIsCreating(true)

    try {
      const createdProject = await createProjectClient<Project>(input)

      if (!isProject(createdProject)) {
        const message = getProjectCreateErrorMessage("PROJECT_CREATE_FAILED")
        setCreateError(message)
        toast.error(message)
        return
      }

      setProjects((current) => [createdProject, ...current])
      setIsCreateOpen(false)
      toast.success("项目已创建")
    } catch (error) {
      const message =
        error instanceof ProjectWorkflowClientError
          ? getProjectCreateErrorMessage(error.code ?? error.message)
          : "项目接口暂时不可用，请稍后再试"
      setCreateError(message)
      toast.error(message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{text.title}</h1>
        <CreateProjectDialog
          key={isCreateOpen ? "open" : "closed"}
          error={createError}
          creating={isCreating}
          open={isCreateOpen}
          options={projectOptions}
          onOpenChange={(open) => {
            setIsCreateOpen(open)
            if (!open) setCreateError("")
            if (open) void loadProjectOptions()
          }}
          onCreate={createProject}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label={text.total} value={projects.length} />
        <MetricCard label={text.risks} value={groupedProjects.risk.length} tone="warn" />
        <MetricCard label={text.upcoming} value={groupedProjects.upcoming.length} />
        <MetricCard label={text.waiting} value={groupedProjects.waiting.length} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4" />
                {text.workbench}
              </CardTitle>
            </div>
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.search}
                className="h-9 pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoadingProjects ? (
            <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {projects.length ? "正在更新项目列表，已显示的项目仍可查看。" : "正在读取项目列表…"}
            </div>
          ) : projectLoadError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <div className="space-y-1 text-sm">
                <p className="text-destructive">{projectLoadError}</p>
                <p className="text-muted-foreground">{projects.length ? "已显示的项目保留，可重试更新列表。" : "尚未取得项目资料，读取失败不表示没有项目。"}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setProjectLoadAttempt((attempt) => attempt + 1)}>
                <RefreshCw className="size-4" />
                重试读取
              </Button>
            </div>
          ) : null}
          {filteredProjects.length > 0 ? (
            <>
              <ProjectGroup title="阻塞/风险项目" projects={groupedProjects.risk} />
              <ProjectGroup title="今天或近期到期" projects={groupedProjects.upcoming} />
              <ProjectGroup title="等待中" projects={groupedProjects.waiting} />
              <ProjectGroup title="普通进行中" projects={groupedProjects.active} />
            </>
          ) : !isLoadingProjects && !projectLoadError ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {projects.length ? text.empty : "还没有项目，可点击“新建项目”开始。"}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function CreateProjectDialog({
  error,
  creating,
  open,
  options,
  onOpenChange,
  onCreate,
}: {
  error: string
  creating: boolean
  open: boolean
  options: ProjectOptionsResponse["data"]
  onOpenChange: (open: boolean) => void
  onCreate: (formData: FormData) => void | Promise<void>
}) {
  const ownerOptions = uniqueOptions(options?.owners ?? [{ label: "运营负责人", value: "运营负责人" }])
  const platformOptions = uniqueOptions(options?.platforms ?? [{ label: "待定", value: "待定" }])
  const communityOptions = uniqueOptions(options?.communities ?? [])
  const [draft, setDraft] = React.useState({
    building: "",
    community: "",
    customer: "",
    name: "",
    platform: platformOptions.find((option) => option.value === "待定")?.value ?? "",
    roomNo: "",
    unitNo: "",
    propertyType: "flat",
  })
  const [isNameEdited, setIsNameEdited] = React.useState(false)
  const generatedName = buildDraftProjectName(draft)
  const projectName = isNameEdited ? draft.name : generatedName

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {text.create}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.create}</DialogTitle>
        </DialogHeader>
        <form action={onCreate} className="grid gap-4">
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <Field
            label={text.customer}
            name="customer"
            placeholder="客户姓名"
            value={draft.customer}
            onChange={(value) => setDraft((current) => ({ ...current, customer: value }))}
          />
          <Field label={text.phone} name="phone" placeholder="联系电话" />
          <Field
            datalistId="project-community-options"
            label={text.community}
            name="community"
            placeholder="选择或输入小区名"
            value={draft.community}
            onChange={(value) => setDraft((current) => ({ ...current, community: value }))}
          />
          <datalist id="project-community-options">
            {communityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={text.building}
              name="building"
              placeholder="楼栋"
              value={draft.building}
              onChange={(value) => setDraft((current) => ({ ...current, building: value }))}
            />
            <Field
              label={text.unitNo}
              name="unitNo"
              placeholder="单元"
              value={draft.unitNo}
              onChange={(value) => setDraft((current) => ({ ...current, unitNo: value }))}
            />
            <Field
              label={text.roomNo}
              name="roomNo"
              placeholder="房号"
              value={draft.roomNo}
              onChange={(value) => setDraft((current) => ({ ...current, roomNo: value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="户型"
              name="propertyType"
              value={draft.propertyType}
              options={[{ label: "平层", value: "flat" }, { label: "别墅", value: "villa" }]}
              placeholder="选择户型"
              onValueChange={(value) => setDraft((current) => ({ ...current, propertyType: value }))}
            />
            <SelectField label="负责人" name="owner" options={ownerOptions} placeholder="选择负责人" />
            <SelectField
              label={text.platform}
              name="platform"
              options={platformOptions}
              placeholder="选择系统平台"
              onValueChange={(value) => setDraft((current) => ({ ...current, platform: value }))}
            />
          </div>
          <Field
            label={text.projectName}
            name="name"
            placeholder="根据资料自动生成，可手动修改"
            value={projectName}
            onChange={(value) => {
              setDraft((current) => ({ ...current, name: value }))
              setIsNameEdited(Boolean(value.trim()))
            }}
          />
          <DialogFooter>
            <Button type="submit" disabled={creating}>
              {creating ? "创建中..." : text.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  datalistId,
  label,
  name,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  datalistId?: string
  label: string
  name: string
  onChange?: (value: string) => void
  placeholder: string
  type?: string
  value?: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        list={datalistId}
        name={name}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </div>
  )
}

function SelectField({
  label,
  name,
  onValueChange,
  options,
  placeholder,
  value: controlledValue,
}: {
  label: string
  name: string
  onValueChange?: (value: string) => void
  options: ProjectOption[]
  placeholder: string
  value?: string
}) {
  const fallbackValue = options[0]?.value ?? ""
  const [value, setValue] = React.useState(controlledValue || fallbackValue)
  const selectedValue = controlledValue || value || fallbackValue

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <input type="hidden" name={name} value={selectedValue} />
      <Select
        key={fallbackValue}
        value={selectedValue}
        onValueChange={(nextValue) => {
          setValue(nextValue)
          onValueChange?.(nextValue)
        }}
      >
        <SelectTrigger id={name} className="h-9 w-full rounded-md">
          <SelectValue placeholder={placeholder} />
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

function buildDraftProjectName(input: {
  building: string
  community: string
  customer: string
  platform: string
  roomNo: string
  unitNo: string
}) {
  const building = formatBuildingNamePart(input.building)
  const unitNo = formatUnitNamePart(input.unitNo)
  const roomNo = input.roomNo.trim()
  const location = [input.community.trim(), building, unitNo, roomNo].filter(Boolean).join(" ")
  const platform = input.platform.trim()

  return [location, input.customer.trim(), platform === "待定" ? "" : platform].filter(Boolean).join(" ")
}

function formatBuildingNamePart(value: string) {
  return appendChineseSuffix(value, ["栋", "幢", "座"], "栋")
}

function formatUnitNamePart(value: string) {
  return appendChineseSuffix(value, ["单元"], "单元")
}

function appendChineseSuffix(value: string, suffixes: string[], suffix: string) {
  const text = value.trim()
  if (!text) return ""
  return suffixes.some((item) => text.endsWith(item)) ? text : `${text}${suffix}`
}

function uniqueOptions(options: ProjectOption[]) {
  const seen = new Set<string>()
  return options.filter((option) => {
    const value = option.value.trim()
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function getProjectCreateErrorMessage(reason: string | undefined) {
  if (reason === "NOT_AUTHENTICATED" || reason === "UNAUTHORIZED") {
    return "当前登录状态无法创建项目"
  }

  if (reason === "PROJECT_LIMIT_REACHED") {
    return "当前免费账户已达到项目数量上限"
  }

  if (reason === "SUBSCRIPTION_EXPIRED") {
    return "当前订阅状态暂不能创建项目"
  }

  if (reason === "ROLE_PERMISSION_DENIED") {
    return "当前角色没有创建项目权限"
  }

  return "项目暂时未能保存到服务器"
}

function ProjectGroup({
  projects,
  title,
}: {
  projects: Project[]
  title: string
}) {
  const router = useRouter()

  if (projects.length === 0) {
    return null
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge variant="outline">{projects.length} 个项目</Badge>
      </div>
      <AdminDataTable
        columns={projectColumns}
        data={projects}
        emptyText={text.empty}
        getRowId={(project) => project.id}
        globalFilterFn={(project, value) =>
          [project.name, project.code, project.customer, project.address, project.nextAction]
            .join(" ")
            .toLowerCase()
            .includes(value.toLowerCase())
        }
        onRowClick={(project) => router.push(`/projects/${encodeURIComponent(project.id)}`)}
        searchPlaceholder="筛选项目..."
      />
    </section>
  )
}

const projectColumns: ColumnDef<Project>[] = [
  {
    accessorKey: "name",
    header: "项目",
    cell: ({ row }) => {
      const project = row.original

      return (
        <div className="min-w-56">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{project.name}</span>
            <RiskBadge risk={project.riskLevel ?? project.risk} />
          </div>
        </div>
      )
    },
  },
  {
    accessorKey: "customer",
    header: "客户",
    cell: ({ row }) => (
      <div className="min-w-44">
        <div className="truncate">{row.original.customer || "-"}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{row.original.address || "-"}</div>
      </div>
    ),
  },
  {
    accessorKey: "owner",
    header: "负责人",
    cell: ({ row }) => (
      <div className="min-w-36">
        <div className="truncate">{row.original.owner || "-"}</div>
        {row.original.nextActionOwnerName && row.original.nextActionOwnerName !== row.original.owner ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">{row.original.nextActionOwnerName}</div>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "stage",
    header: "状态",
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{getStage(row.original.stage).label}</Badge>
        {row.original.stageStatusLabel ? <Badge variant="secondary">{row.original.stageStatusLabel}</Badge> : null}
        <Badge variant="secondary">{waitingOnLabel(row.original.waitingOn)}</Badge>
      </div>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "创建时间",
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">{formatDate(row.original.createdAt)}</div>
    ),
  },
  {
    id: "actions",
    header: "",
    enableHiding: false,
    cell: ({ row }) => <ProjectRowActions project={row.original} />,
  },
]

function ProjectRowActions({ project }: { project: Project }) {
  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="打开项目操作">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <a href={`/projects/${encodeURIComponent(project.id)}`}>
              <FolderKanban className="size-4" />
              项目工作台
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/point-map?projectId=${encodeURIComponent(project.id)}`}>
              <MapPinned className="size-4" />
              点位图
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/quotes?projectId=${encodeURIComponent(project.id)}`}>
              <FileText className="size-4" />
              方案报价
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={`/projects/${encodeURIComponent(project.id)}?tab=contract`}>
              <FileCheck2 className="size-4" />
              合同
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold", tone === "warn" && "text-destructive")}>{value}</div>
      </CardContent>
    </Card>
  )
}

function RiskBadge({ risk }: { risk: Risk }) {
  if (risk === "blocked") {
    return (
      <Badge variant="destructive">
        <ShieldAlert className="size-3" />
        {text.blocked}
      </Badge>
    )
  }

  if (risk === "watch") return <Badge variant="secondary">{text.watch}</Badge>

  return <Badge variant="outline">{text.normal}</Badge>
}

function waitingOnLabel(waitingOn: Project["waitingOn"]) {
  if (waitingOn === "customer") return "等客户"
  if (waitingOn === "internal") return "等内部"
  if (waitingOn === "vendor") return "等供应商"
  return "未等待"
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

function isProject(project: Project | undefined): project is Project {
  return Boolean(project?.id && project.name && getStage(project.stage))
}

function getStage(key: StageKey) {
  return stages.find((stage) => stage.key === key) ?? stages[0]
}

