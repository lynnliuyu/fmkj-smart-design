"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BadgeCheck,
  CalendarClock,
  Edit3,
  Eye,
  FileCheck2,
  FileText,
  FolderKanban,
  Link2,
  Loader2,
  MoreHorizontal,
  Search,
  UploadCloud,
} from "lucide-react";

import { SummaryTile } from "@/components/business/summary-tile";
import { AdminDataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  loadContractAttachments,
  type ProjectAttachment,
} from "@/lib/contract-attachments";
import { cn } from "@/lib/utils";

type ProjectStage =
  | "new"
  | "measure"
  | "proposal"
  | "contract"
  | "install"
  | "acceptance"
  | "aftercare";

type Project = {
  id: string;
  name: string;
  code: string;
  customer: string;
  createdAt?: string;
  quoteAmount: number | null;
  stage: ProjectStage;
  risk: "normal" | "watch" | "blocked";
  nextAction: string;
};

const stageLabels: Record<ProjectStage, string> = {
  acceptance: "交付验收",
  aftercare: "售后维护",
  contract: "合同收款",
  install: "安装调试",
  measure: "现场测量",
  new: "新建跟进",
  proposal: "方案报价",
};

export function ContractsWorkbench() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [attachmentsByProject, setAttachmentsByProject] = React.useState<
    Record<string, ProjectAttachment[]>
  >({});
  const [previewProjectId, setPreviewProjectId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [uploadingProjectId, setUploadingProjectId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    let active = true;

    async function loadContracts() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const payload = (await response.json()) as { data?: Project[] };
        const nextProjects = payload.data?.filter(isProject) ?? [];

        if (!active) return;

        setProjects(nextProjects);

        const contractsByProject = await loadContractAttachments(
          nextProjects.map((project) => project.id),
        );

        if (active) {
          setAttachmentsByProject(contractsByProject);
        }
      } catch {
        if (active) {
          setProjects([]);
          setAttachmentsByProject({});
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadContracts();

    return () => {
      active = false;
    };
  }, []);

  const visibleProjects = projects.filter((project) => {
    const value = query.trim().toLowerCase();
    const contracts = attachmentsByProject[project.id] ?? [];
    const haystack = [
      project.name,
      project.code,
      project.customer,
      stageLabels[project.stage],
      ...contracts.map((contract) => contract.fileName),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(value);
  });
  const previewProject =
    projects.find((project) => project.id === previewProjectId) ?? null;
  const previewContracts = previewProject
    ? (attachmentsByProject[previewProject.id] ?? [])
    : [];
  const signedProjects = projects.filter(
    (project) => (attachmentsByProject[project.id] ?? []).length > 0,
  );
  const contractAmount = signedProjects.reduce(
    (sum, project) => sum + Number(project.quoteAmount ?? 0),
    0,
  );
  const contractColumns = React.useMemo(
    () =>
      createContractColumns(
        attachmentsByProject,
        uploadingProjectId,
        uploadContract,
        (project) => {
          setPreviewProjectId(project.id);
          setIsPreviewOpen(true);
        },
      ),
    [attachmentsByProject, uploadingProjectId],
  );

  async function uploadContract(projectId: string, file: File | null) {
    if (!file) return;

    setUploadingProjectId(projectId);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "contract");
      formData.append("entityId", projectId);

      const uploadResponse = await fetch("/api/upload", {
        body: formData,
        method: "POST",
      });
      const uploadPayload = (await uploadResponse.json()) as {
        data?: {
          contentType: string;
          fileName: string;
          size: number;
          url: string;
        };
        error?: string;
      };

      if (!uploadResponse.ok || !uploadPayload.data) {
        throw new Error(uploadPayload.error ?? "UPLOAD_FAILED");
      }

      const saveResponse = await fetch("/api/attachments", {
        body: JSON.stringify({
          contentType: uploadPayload.data.contentType,
          fileName: uploadPayload.data.fileName,
          fileUrl: uploadPayload.data.url,
          kind: "contract",
          projectId,
          size: uploadPayload.data.size,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const savePayload = (await saveResponse.json()) as {
        data?: ProjectAttachment;
        error?: string;
      };

      if (!saveResponse.ok || !savePayload.data) {
        throw new Error(savePayload.error ?? "ATTACHMENT_SAVE_FAILED");
      }

      setAttachmentsByProject((current) => ({
        ...current,
        [projectId]: [savePayload.data!, ...(current[projectId] ?? [])],
      }));
      setPreviewProjectId(projectId);
    } finally {
      setUploadingProjectId(null);
    }
  }

  if (isLoading) {
    return (
      <section className="grid min-h-[420px] place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载合同
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">合同管理</h1>
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、客户、合同文件"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="项目数"
          value={projects.length.toString()}
          icon={FolderKanban}
        />
        <MetricCard
          label="已上传合同"
          value={signedProjects.length.toString()}
          icon={BadgeCheck}
        />
        <MetricCard
          label="合同文件"
          value={Object.values(attachmentsByProject).flat().length.toString()}
          icon={FileCheck2}
        />
        <MetricCard
          label="签约金额"
          value={money(contractAmount)}
          icon={FileText}
        />
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>项目合同</CardTitle>
            <CardDescription>
              {visibleProjects.length} 个匹配项目
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={contractColumns}
              data={visibleProjects}
              emptyText="没有匹配项目"
              getRowId={(project) => project.id}
              globalFilterFn={(project, value) => {
                const contracts = attachmentsByProject[project.id] ?? [];

                return [
                  project.name,
                  project.code,
                  project.customer,
                  stageLabels[project.stage],
                  ...contracts.map((contract) => contract.fileName),
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(value.toLowerCase());
              }}
              searchPlaceholder="筛选合同项目..."
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="text-start">
            <SheetTitle>合同预览</SheetTitle>
            <SheetDescription>
              {previewProject
                ? `${previewProject.name} / ${previewProject.customer || "-"}`
                : "查看合同详情"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            {previewProject ? (
              <ContractPreview
                contracts={previewContracts}
                onUpload={uploadContract}
                project={previewProject}
                uploadingProjectId={uploadingProjectId}
              />
            ) : null}
          </div>
          <SheetFooter className="gap-2">
            {previewProject ? (
              <Button asChild>
                <a
                  href={`/projects/${encodeURIComponent(previewProject.id)}?tab=contract`}
                >
                  <Edit3 className="size-4" />
                  项目内编辑
                </a>
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function createContractColumns(
  attachmentsByProject: Record<string, ProjectAttachment[]>,
  uploadingProjectId: string | null,
  onUpload: (projectId: string, file: File | null) => void,
  onPreview: (project: Project) => void,
): ColumnDef<Project>[] {
  return [
    {
      accessorKey: "name",
      header: "项目",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.original.customer || "-"} / {row.original.code}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "stage",
      header: "状态",
      cell: ({ row }) => {
        const contracts = attachmentsByProject[row.original.id] ?? [];

        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <StageBadge stage={row.original.stage} />
            <Badge variant={contracts.length ? "default" : "outline"}>
              {contracts.length ? "已签约" : "待合同"}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "创建时间",
      cell: ({ row }) => (
        <div className="text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </div>
      ),
    },
    {
      accessorKey: "quoteAmount",
      header: "报价金额",
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {row.original.quoteAmount
            ? money(row.original.quoteAmount)
            : "待报价"}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => (
        <ContractProjectActions
          onPreview={onPreview}
          onUpload={onUpload}
          project={row.original}
          uploadingProjectId={uploadingProjectId}
        />
      ),
    },
  ];
}

function ContractProjectActions({
  onPreview,
  onUpload,
  project,
  uploadingProjectId,
}: {
  onPreview: (project: Project) => void;
  onUpload: (projectId: string, file: File | null) => void;
  project: Project;
  uploadingProjectId: string | null;
}) {
  return (
    <div
      className="flex justify-end"
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 p-0 text-muted-foreground data-[state=open]:bg-muted"
            aria-label="打开合同操作"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onPreview(project)}>
            <Eye className="size-4" />
            预览
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href={`/projects/${encodeURIComponent(project.id)}?tab=contract`}
            >
              <Edit3 className="size-4" />
              项目内编辑
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1">
            <ContractUploadButton
              compact
              disabled={uploadingProjectId === project.id}
              loading={uploadingProjectId === project.id}
              projectId={project.id}
              onUpload={onUpload}
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ContractPreview({
  contracts,
  onUpload,
  project,
  uploadingProjectId,
}: {
  contracts: ProjectAttachment[];
  onUpload: (projectId: string, file: File | null) => void;
  project: Project;
  uploadingProjectId: string | null;
}) {
  return (
    <div className="space-y-6 pb-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={project.stage} />
          <Badge variant={contracts.length ? "default" : "outline"}>
            {contracts.length ? "已上传合同" : "待上传合同"}
          </Badge>
        </div>
        <h2 className="text-base font-semibold leading-6">{project.name}</h2>
        <p className="text-sm text-muted-foreground">
          {project.code} / {project.customer || "-"}
        </p>
      </div>

      <div className="grid gap-3 text-sm">
        <SummaryTile label="客户" value={project.customer || "-"} />
        <SummaryTile
          label="报价金额"
          value={project.quoteAmount ? money(project.quoteAmount) : "待生成"}
        />
        <SummaryTile
          label="合同状态"
          value={contracts.length ? "已上传合同" : "待上传合同"}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4 text-muted-foreground" />
          下一步
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          {project.nextAction || "确认合同、收款节点和开工安排。"}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">合同文件</div>
          <ContractUploadButton
            disabled={uploadingProjectId !== null}
            loading={uploadingProjectId === project.id}
            projectId={project.id}
            onUpload={onUpload}
          />
        </div>

        {contracts.length > 0 ? (
          contracts.map((contract) => (
            <a
              key={contract.id}
              href={contract.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-md border bg-background p-3 transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {contract.fileName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(contract.size)} /{" "}
                  {formatDate(contract.createdAt)}
                </span>
              </span>
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ))
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有上传合同
          </div>
        )}
      </div>
    </div>
  );
}

function ContractUploadButton({
  compact,
  disabled,
  loading,
  projectId,
  onUpload,
}: {
  compact?: boolean;
  disabled: boolean;
  loading: boolean;
  projectId: string;
  onUpload: (projectId: string, file: File | null) => void;
}) {
  const inputId = React.useId();

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <UploadCloud className="size-4" />
      )}
      {compact ? "上传" : "上传合同"}
      <input
        id={inputId}
        type="file"
        accept="application/pdf,.pdf,.doc,.docx"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          onUpload(projectId, event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function StageBadge({ stage }: { stage: ProjectStage }) {
  return (
    <Badge variant={stage === "contract" ? "default" : "outline"}>
      {stageLabels[stage] ?? stage}
    </Badge>
  );
}

function isProject(project: Project | undefined): project is Project {
  return Boolean(project?.id && project.name && project.stage);
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | undefined) {
  if (!value) return "-";

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) return "-";

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
