"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarClock,
  Edit3,
  Eye,
  Link2,
  Loader2,
  MoreHorizontal,
  UploadCloud,
} from "lucide-react";

import { ProjectListHeader, ProjectSearchInput } from "@/components/business/project-list-shell";
import { StatStrip } from "@/components/business/summary-tile";
import {
  fetchProjectListRows,
  formatProjectDate,
  projectMatchesQuery,
  projectStageLabel,
} from "@/lib/project-list";
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



export function ContractsWorkbench() {
  const searchParams = useSearchParams();
  /** 项目内进入时只显示该项目；/contracts 本身仍保留全量列表。 */
  const requestedProjectId = searchParams.get("projectId");
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
        const nextProjects = await fetchProjectListRows<Project>();

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

  const scopedProject = requestedProjectId
    ? projects.find((project) => project.id === requestedProjectId) ?? null
    : null;
  const scopedProjects = requestedProjectId
    ? scopedProject
      ? [scopedProject]
      : []
    : projects;

  const visibleProjects = scopedProjects.filter((project) =>
    projectMatchesQuery(query, [
      project.name,
      project.code,
      project.customer,
      project.stage,
      projectStageLabel(project.stage),
      ...(attachmentsByProject[project.id] ?? []).map((contract) => contract.fileName),
    ]),
  );
  const previewProject =
    projects.find((project) => project.id === previewProjectId) ?? null;
  const previewContracts = previewProject
    ? (attachmentsByProject[previewProject.id] ?? [])
    : [];
  const signedProjects = scopedProjects.filter(
    (project) => (attachmentsByProject[project.id] ?? []).length > 0,
  );
  const contractAmount = signedProjects.reduce(
    (sum, project) => sum + Number(project.quoteAmount ?? 0),
    0,
  );
  const scopedFileCount = scopedProjects.reduce(
    (sum, project) => sum + (attachmentsByProject[project.id] ?? []).length,
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
      <div>
        <ProjectListHeader
          title="合同管理"
          actions={
            <ProjectSearchInput
              value={query}
              onChange={setQuery}
              placeholder="搜索项目、客户、合同文件"
            />
          }
        />
      </div>

      {requestedProjectId ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <span className="font-medium">
            {scopedProject ? `仅看本项目：${scopedProject.name}` : "未找到该项目"}
          </span>
          <Link
            href="/contracts"
            className="ms-auto text-sm text-muted-foreground underline-offset-3 hover:text-foreground hover:underline"
          >
            查看全部项目
          </Link>
        </div>
      ) : null}

      <StatStrip
        items={[
          { label: "项目数", value: scopedProjects.length },
          { label: "已上传合同", value: signedProjects.length },
          { label: "合同文件", value: scopedFileCount },
          { label: "签约金额", value: money(contractAmount) },
        ]}
      />

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
                  projectStageLabel(project.stage),
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
          {formatProjectDate(row.original.createdAt)}
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
                  {formatProjectDate(contract.createdAt)}
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


function StageBadge({ stage }: { stage: ProjectStage }) {
  return (
    <Badge variant={stage === "contract" ? "default" : "outline"}>
      {projectStageLabel(stage)}
    </Badge>
  );
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
