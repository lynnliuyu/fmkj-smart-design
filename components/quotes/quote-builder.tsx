"use client"

import { ProjectViewSwitch } from "@/components/projects/project-view-switch";
import { flushSync } from "react-dom"
import { releasePointMapPrintFloors, renderPointMapPrintFloors, waitForPrintImages, type PointMapPrintFloor } from "@/lib/point-map-print"
import { prepareQuoteExportSource } from "@/lib/project-delivery-client"
import { deliveryLineTotal, deliveryLineUnitPrice } from "@/lib/project-delivery"
import { CategoryProductSwitch } from "@/components/quotes/category-product-switch";
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  ArrowLeft,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { SummaryTile } from "@/components/business/summary-tile"
import { DocumentBrand, DocumentPrintFooter } from "@/components/business/document-brand"
import { DOCUMENT_BRAND } from "@/lib/document-brand"
import { quoteVerification, quoteVerificationLabel } from "@/lib/quote-verification"
import { quoteDisplaySpec } from "@/lib/quote-spec"
import { isSvgImage } from "@/lib/image-src"
import { AdminDataTable } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useQuoteAuthoring } from "@/components/quotes/use-quote-authoring"
import {
  lineTotal,
  money,
  productPrice,
  quoteUnitPrice,
  type QuoteGroupMode as GroupMode,
  type QuoteLineItem as QuoteItem,
  type QuoteProductOption as ProductOption,
  type QuoteProjectOption as QuoteProject,
  floorOfRoom,
  groupQuoteItems,
  quoteFloorPages,
} from "@/lib/quote-authoring"
import { cn } from "@/lib/utils"

type QuoteFloorImage = PointMapPrintFloor
type QuotePrintSnapshot = {
  deliveryVersion: number
  quoteNo: string
  date: string
  discountTotal: number
  floorImages: QuoteFloorImage[]
  groups: Array<{ name: string; items: QuoteItem[] }>
  installationFee: number
  project: string
  status: string
  subtotal: number
  total: number
}

export function QuoteBuilder() {
  const searchParams = useSearchParams()
  const requestedProjectId = searchParams.get("projectId")
  const quote = useQuoteAuthoring({ requestedProjectId })
  const {
    groupMode,
    installationFee,
    isUploadingPdf,
    roomNotice,
    rooms,
    saveState,
    selectedProject,
    selectedProjectId,
    status,
  } = quote.state
  const { discountTotal, groups, payableTotal, projectOptions, quoteProducts, subtotal } = quote.computed
  const [floorPage, setFloorPage] = React.useState<string | null>(null)
  const [printSnapshot, setPrintSnapshot] = React.useState<QuotePrintSnapshot | null>(null)
  const [isPreparingPdf, setIsPreparingPdf] = React.useState(false)
  const [pdfError, setPdfError] = React.useState("")
  const [imageRefreshNotice, setImageRefreshNotice] = React.useState("")
  const printDocumentRef = React.useRef<HTMLElement | null>(null)
  const preparingPdfRef = React.useRef(false)
  React.useEffect(() => () => { if (printSnapshot) releasePointMapPrintFloors(printSnapshot.floorImages) }, [printSnapshot])
  const floorPages = React.useMemo(() => quoteFloorPages(quote.state.items), [quote.state.items])
  // 当前楼层页不存在时（例如行被删除）回到全部楼层。
  const activeFloorPage = floorPage && floorPages.includes(floorPage) ? floorPage : null
  // 分组列表来自整单房间清单，楼层页下要去掉其他楼层的空房间组。
  // 只显示有明细的分组，避免房间清单里没有产品的房间变成空框。
  const visibleGroups = (activeFloorPage
    ? groups.map((group) => ({ ...group, items: group.items.filter((item) => floorOfRoom(item.room) === activeFloorPage) }))
    : groups
  ).filter((group) => group.items.length > 0)

  const {
    addProductToQuote,
    addRoom,
    changeProject,
    deleteRoom,
    removeItem,
    renameRoom,
    prepareSavedQuoteForExport,
    refreshDraftProductImages,
    saveDraft,
    setGroupMode,
    setInstallationFee,
    updateItem,
    uploadQuotePdf,
  } = quote.actions

  async function exportPdf() {
    if (preparingPdfRef.current || quote.state.isLoadingQuote || quote.state.quoteLoadError) return
    preparingPdfRef.current = true
    setIsPreparingPdf(true)
    setPdfError("")
    const originalTitle = document.title
    let images: PointMapPrintFloor[] = []
    let committed = false
    try {
      // Saving may remove or move sourced points, so read the point plan only after it finishes.
      const saved = await prepareSavedQuoteForExport()
      const source = await prepareQuoteExportSource({ projectId: saved.projectId, snapshot: saved.snapshot })
      saved.assertCurrent()
      const delivery = source.kind === "delivery" ? source.delivery : null
      if (delivery) images = await renderPointMapPrintFloors(delivery.plan, delivery.quote!.items, delivery.products, { cacheNamespace: `project:${saved.projectId}` })
      saved.assertCurrent()
      flushSync(() => setPrintSnapshot({
        deliveryVersion: delivery?.version ?? 0,
        quoteNo: delivery?.quote?.quoteNo ?? saved.snapshot.quoteNo,
        status: delivery?.quote ? delivery.quote.status === "draft" ? "草稿" : delivery.quote.status : saved.snapshot.status,
        subtotal: delivery?.quote?.subtotal ?? saved.snapshot.subtotal,
        discountTotal: delivery?.quote?.discount ?? saved.snapshot.discountTotal,
        total: delivery?.quote?.total ?? saved.snapshot.total,
        installationFee: delivery?.quote?.installationFee ?? saved.snapshot.installationFee,
        groups: delivery?.quote ? groupQuoteItems(delivery.quote.items, groupMode, [...new Set(delivery.quote.items.map((item) => item.category))], delivery.quote.rooms) : saved.snapshot.groups,
        project: delivery?.project.name ?? saved.projectName,
        date: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(delivery ? new Date(delivery.createdAt) : new Date()),
        floorImages: images,
      }))
      committed = true
      if (!printDocumentRef.current) throw new Error("报价打印内容尚未准备好，请重试。")
      await waitForPrintImages(printDocumentRef.current)
      saved.assertCurrent()
      document.title = `${DOCUMENT_BRAND.companyName}-报价单${delivery ? `-V${delivery.version}` : ""}-${delivery?.project.name ?? saved.projectName}`
      window.print()
    } catch (error) {
      setPdfError(`导出失败：${error instanceof Error ? error.message : "请重试。"}`)
    } finally {
      if (!committed) releasePointMapPrintFloors(images)
      document.title = originalTitle
      preparingPdfRef.current = false
      setIsPreparingPdf(false)
    }
  }

  if (!requestedProjectId) {
    return <QuoteIndex />
  }

  return (
    <>
      <section className="quote-workbench flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">方案报价</h1>
            <p className="text-sm text-muted-foreground">
              按房间或产品类型整理方案明细，导出 PDF 时会使用正式客户报价单版式。
            </p>
          </div>
          <div className="quote-print-hidden flex flex-wrap gap-2">
            {selectedProjectId ? (
              <ProjectViewSwitch
                active="quote"
                projectId={selectedProjectId}
                hasUnsavedChanges={quote.state.hasUnsavedChanges}
                onSave={saveDraft}
              />
            ) : null}
            {selectedProjectId ? (
              <Button asChild variant="outline">
                <a href={`/projects/${encodeURIComponent(selectedProjectId)}?tab=solution-quote`}>
                  <ArrowLeft className="size-4" />
                  返回项目
                </a>
              </Button>
            ) : null}
            <Button variant="outline" onClick={exportPdf} disabled={isPreparingPdf || quote.state.isLoadingQuote || Boolean(quote.state.quoteLoadError)}>
              <Download className="size-4" />
              {isPreparingPdf ? "正在准备报价单…" : "预览 / 导出 PDF"}
            </Button>
            <Button variant="outline" disabled={saveState === "saving" || isPreparingPdf || quote.state.isRefreshingImages || quote.state.isLoadingQuote || Boolean(quote.state.quoteLoadError)} onClick={async () => {
              setImageRefreshNotice("")
              const saved = await refreshDraftProductImages()
              setImageRefreshNotice(saved ? "商品图片已更新，未保存的报价编辑继续保留。" : "商品图片未更新，请刷新报价后重试；本次未覆盖任何编辑。")
            }}><RefreshCw className="size-4" />{quote.state.isRefreshingImages ? "正在更新图片…" : "更新商品图片"}</Button>
            <label
              className={cn(
                "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted",
                (!selectedProjectId || isUploadingPdf) && "pointer-events-none opacity-50"
              )}
            >
              {isUploadingPdf ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              上传 PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={!selectedProjectId || isUploadingPdf}
                onChange={(event) => {
                  void uploadQuotePdf(event.target.files?.[0] ?? null)
                  event.currentTarget.value = ""
                }}
              />
            </label>
          </div>
        </div>

        {pdfError || quote.state.quoteLoadError ? <p role="alert" className="text-sm text-destructive">{pdfError || quote.state.quoteLoadError}</p> : null}
        {quote.state.quoteSaveError ? <p role="alert" className="quote-print-hidden text-sm text-destructive">{quote.state.quoteSaveError}</p> : null}
        {imageRefreshNotice ? <p role="status" className="text-sm text-muted-foreground">{imageRefreshNotice}</p> : null}
        <p className="quote-print-hidden text-xs text-muted-foreground">默认型号可用于未核验报价，仍需核对规格与现场条件。删除点位来源报价行或区域，会在保存时同步删除关联安装点与相关场景引用；历史版本保留。</p>

        <Card className="quote-print-card">
          <CardContent className="grid gap-4 p-4 text-sm md:grid-cols-4">
            <InfoBlock label="报价项目" value={selectedProject} />
            <InfoBlock label="报价编号" value={quote.state.quoteNo || "待保存"} />
            <InfoBlock label="报价状态" value={status} />
            <InfoBlock label="有效期" value="15 天" />
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="quote-print-card">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>报价单明细</CardTitle>
                  <CardDescription>可按房间、产品类型或不分组查看；按楼层切换页面。</CardDescription>
                </div>
                <Tabs
                  value={groupMode}
                  onValueChange={(value) => setGroupMode(value as GroupMode)}
                  className="quote-print-hidden"
                >
                  <TabsList>
                    <TabsTrigger value="room">按房间</TabsTrigger>
                    <TabsTrigger value="type">按类型</TabsTrigger>
                    <TabsTrigger value="none">不分组</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <CategoryProductSwitch key={selectedProjectId} products={quoteProducts} projectId={selectedProjectId} projectName={selectedProject} />
              {roomNotice && <p role="alert" className="quote-print-hidden text-sm text-destructive">{roomNotice}</p>}
              {floorPages.length > 1 && (
                <div role="tablist" aria-label="楼层分页" className="quote-print-hidden flex flex-wrap gap-2">
                  <Button size="sm" variant={activeFloorPage === null ? "secondary" : "outline"} aria-pressed={activeFloorPage === null} onClick={() => setFloorPage(null)}>全部楼层</Button>
                  {floorPages.map((floor) => (
                    <Button key={floor} size="sm" variant={activeFloorPage === floor ? "secondary" : "outline"} aria-pressed={activeFloorPage === floor} onClick={() => setFloorPage(floor)}>{floor}</Button>
                  ))}
                </div>
              )}
              {visibleGroups.map((group) => (
                <QuoteGroup
                  key={`${groupMode}-${group.name}`}
                  groupName={group.name}
                  items={group.items}
                  products={quoteProducts}
                  rooms={rooms}
                  onAdd={addProductToQuote}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="quote-print-hidden">
            <CardHeader>
              <CardTitle>费用与房间</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2">
                <Label htmlFor="project">关联项目</Label>
                <Select value={selectedProject} onValueChange={changeProject}>
                  <SelectTrigger id="project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((projectItem) => (
                      <SelectItem key={projectItem} value={projectItem}>
                        {projectItem}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="installation-fee">{"\u8c03\u8bd5\u5b89\u88c5\u8d39\u7528"}</Label>
                <Input
                  id="installation-fee"
                  min={0}
                  type="number"
                  value={installationFee}
                  onChange={(event) => {
                    setInstallationFee(Math.max(0, Number(event.target.value) || 0))
                  }}
                />
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">报价说明</span>
                <p className="text-sm text-muted-foreground">报价含基础安装调试，不含强电改造和额外布线费用。最终金额以现场复核和客户确认版本为准。</p>
              </div>
              <RoomManager
                rooms={rooms}
                onAdd={addRoom}
                onRename={renameRoom}
                onDelete={deleteRoom}
              />
              <Separator />
              <div className="space-y-3 text-sm">
                <TotalLine label="原价合计" value={money(subtotal)} />
                <TotalLine label="优惠金额" value={`-${money(discountTotal)}`} />
                <TotalLine label={"\u8c03\u8bd5\u5b89\u88c5\u8d39\u7528"} value={money(installationFee)} />
                <TotalLine label="应收合计" value={money(payableTotal)} strong />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={saveDraft} disabled={saveState === "saving"}>
                  {saveState === "saving"
                    ? "\u4fdd\u5b58\u4e2d"
                    : saveState === "saved"
                      ? "\u5df2\u4fdd\u5b58"
                      : saveState === "error"
                        ? "\u4fdd\u5b58\u5931\u8d25"
                        : "\u4fdd\u5b58\u8349\u7a3f"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <QuotePrintDocument
        {...(printSnapshot ?? { deliveryVersion: 0, quoteNo: quote.state.quoteNo || "待保存", date: "", discountTotal, floorImages: [], groups, project: selectedProject, status, installationFee, subtotal, total: payableTotal })}
        documentRef={printDocumentRef}
      />
    </>
  )
}

function QuoteIndex() {
  const [projects, setProjects] = React.useState<QuoteProject[]>([])
  const [previewProjectId, setPreviewProjectId] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true

    async function loadProjects() {
      setIsLoading(true)

      try {
        const response = await fetch("/api/projects", { cache: "no-store" })
        const payload = (await response.json()) as { data?: QuoteProject[] }
        const nextProjects = payload.data?.filter((project) => project.id && project.name) ?? []

        if (active) {
          setProjects(nextProjects)
        }
      } catch {
        if (active) {
          setProjects([])
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadProjects()

    return () => {
      active = false
    }
  }, [])

  const visibleProjects = projects.filter((project) => {
    const keyword = query.trim().toLowerCase()

    if (!keyword) return true

    return [project.name, project.code, project.customer, project.stage]
      .join(" ")
      .toLowerCase()
      .includes(keyword)
  })
  const previewProject = projects.find((project) => project.id === previewProjectId) ?? null
  const quotedProjects = projects.filter((project) => Number(project.quoteAmount ?? 0) > 0)
  const quoteTotal = quotedProjects.reduce((sum, project) => sum + Number(project.quoteAmount ?? 0), 0)
  const quoteProjectColumns = React.useMemo(
    () =>
      createQuoteProjectColumns((project) => {
        setPreviewProjectId(project.id)
        setIsPreviewOpen(true)
      }),
    []
  )

  if (isLoading) {
    return (
      <section className="grid min-h-[420px] place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载报价
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">报价列表</h1>
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、客户、报价状态"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="项目数" value={projects.length.toString()} />
        <SummaryCard label="已有报价" value={quotedProjects.length.toString()} />
        <SummaryCard label="报价金额" value={money(quoteTotal)} />
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>项目报价</CardTitle>
            <CardDescription>{visibleProjects.length} 个匹配项目</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminDataTable
              columns={quoteProjectColumns}
              data={visibleProjects}
              emptyText="没有匹配项目"
              getRowId={(project) => project.id}
              globalFilterFn={(project, value) =>
                [project.name, project.code, project.customer, project.stage]
                  .join(" ")
                  .toLowerCase()
                  .includes(value.toLowerCase())
              }
              searchPlaceholder="筛选报价项目..."
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="text-start">
            <SheetTitle>报价预览</SheetTitle>
            <SheetDescription>
              {previewProject ? `${previewProject.name} / ${previewProject.customer || "-"}` : "查看报价详情"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            {previewProject ? <QuoteProjectPreview project={previewProject} /> : null}
          </div>
          <SheetFooter className="gap-2">
            {previewProject ? (
              <Button asChild>
                <a href={`/quotes?projectId=${encodeURIComponent(previewProject.id)}`}>
                  <Edit3 className="size-4" />
                  编辑报价
                </a>
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}

function createQuoteProjectColumns(onPreview: (project: QuoteProject) => void): ColumnDef<QuoteProject>[] {
  return [
    {
      accessorKey: "name",
      header: "项目",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{row.original.code || "-"}</div>
        </div>
      ),
    },
    {
      accessorKey: "customer",
      header: "客户",
      cell: ({ row }) => row.original.customer || "-",
    },
    {
      accessorKey: "createdAt",
      header: "创建时间",
      cell: ({ row }) => (
        <div className="text-muted-foreground">{formatDate(row.original.createdAt)}</div>
      ),
    },
    {
      accessorKey: "stage",
      header: "状态",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={row.original.quoteAmount ? "default" : "outline"}>
            {row.original.quoteAmount ? "已有报价" : "待报价"}
          </Badge>
          {row.original.stage ? <Badge variant="secondary">{row.original.stage}</Badge> : null}
        </div>
      ),
    },
    {
      accessorKey: "quoteAmount",
      header: "报价金额",
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {row.original.quoteAmount ? money(row.original.quoteAmount) : "待生成"}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => <QuoteProjectActions onPreview={onPreview} project={row.original} />,
    },
  ]
}

function QuoteProjectActions({
  onPreview,
  project,
}: {
  onPreview: (project: QuoteProject) => void
  project: QuoteProject
}) {
  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 p-0 text-muted-foreground data-[state=open]:bg-muted" aria-label="打开报价操作">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onPreview(project)}>
            <Eye className="size-4" />
            预览
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/quotes?projectId=${encodeURIComponent(project.id)}`}>
              <Edit3 className="size-4" />
              编辑报价
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/projects/${encodeURIComponent(project.id)}?tab=quote`}>
              <FolderKanban className="size-4" />
              项目工作台
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={`/projects/${encodeURIComponent(project.id)}?tab=contract`}>
              <FileText className="size-4" />
              合同
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function QuoteProjectPreview({ project }: { project: QuoteProject }) {
  return (
    <div className="space-y-6 pb-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={project.quoteAmount ? "default" : "outline"}>
            {project.quoteAmount ? "已有报价" : "待报价"}
          </Badge>
          {project.stage ? <Badge variant="secondary">{project.stage}</Badge> : null}
        </div>
        <h2 className="text-base font-semibold leading-6">{project.name}</h2>
        <p className="text-sm text-muted-foreground">
          {project.code || "-"} / {project.customer || "-"}
        </p>
      </div>

      <div className="grid gap-3 text-sm">
        <SummaryTile label="客户" value={project.customer || "-"} />
        <SummaryTile label="报价金额" value={project.quoteAmount ? money(project.quoteAmount) : "待生成"} />
        <SummaryTile label="报价版本" value="当前草稿" />
        <SummaryTile label="创建时间" value={formatDate(project.createdAt)} />
      </div>

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline">
          <a href={`/projects/${encodeURIComponent(project.id)}?tab=quote`}>
            <FolderKanban className="size-4" />
            返回项目工作台
          </a>
        </Button>
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

function QuotePrintDocument({
  deliveryVersion,
  quoteNo,
  date,
  discountTotal,
  documentRef,
  floorImages,
  groups,
  installationFee,
  project,
  status,
  subtotal,
  total,
}: QuotePrintSnapshot & { documentRef: React.Ref<HTMLElement> }) {
  const visibleGroups = groups.filter((group) => group.items.length > 0)

  return (
    <article className="quote-document hidden" ref={documentRef}>
      <header className="quote-document-hero">
        <div>
          <DocumentBrand />
          <h1>智能家居方案报价单</h1>
          <p>{project}</p>
        </div>
        <div className="quote-document-no">
          <span>报价编号</span>
          <strong>{quoteNo}</strong>
          {deliveryVersion > 0 ? <span>方案版本 V{deliveryVersion}</span> : null}
        </div>
      </header>

      <section className="quote-document-meta">
        <InfoBlock label="客户项目" value={project} />
        <InfoBlock label="报价状态" value={status} />
        <InfoBlock label="有效期" value="15 天" />
        <InfoBlock label="报价日期" value={date} />
      </section>

      <section className="quote-document-total">
        <div>
          <span>应收合计</span>
          <strong>{money(total)}</strong>
        </div>
        <div className="quote-document-total-grid quote-document-total-grid-compact">
          <TotalLine label={"\u4ea7\u54c1\u5408\u8ba1"} value={money(subtotal - discountTotal)} />
          <TotalLine label={"\u8c03\u8bd5\u5b89\u88c5\u8d39\u7528"} value={money(installationFee)} />
          <TotalLine label={"\u62a5\u4ef7\u603b\u4ef7"} value={money(total)} strong />
        </div>
      </section>

      <section className="quote-document-sections">
        {visibleGroups.map((group) => {
          const groupTotal = group.items.reduce((sum, item) => sum + deliveryLineTotal(item), 0)

          return (
            <div key={group.name} className="quote-document-section">
              <div className="quote-document-section-title">
                <h2>{group.name}</h2>
                <span>{money(groupTotal)}</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>规格</th>
                    <th>房间</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>{"\u603b\u4ef7"}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.lineId}>
                      <td>
                        <div className="quote-document-product">
                          <ProductThumb product={item} eager />
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.category}</span>
                            <span>{quoteVerificationLabel(item)}</span>
                          </div>
                        </div>
                      </td>
                      <td>{quoteDisplaySpec(item.spec, item.name) || "—"}</td>
                      <td>{item.room}</td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
                      <td>{money(deliveryLineUnitPrice(item))}</td>
                      <td>{money(deliveryLineTotal(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </section>

      <footer className="quote-document-footer">
        <div className="quote-document-company">
          <strong>{DOCUMENT_BRAND.companyName}</strong>
          <p>{"\u5ba2\u6237\u62a5\u4ef7\u4e13\u7528\u6587\u4ef6"}</p>
        </div>
        <div>
          <strong>报价说明</strong>
          <p>
            报价含基础安装调试，不含强电改造和额外布线费用。最终金额以现场复核和客户确认版本为准。
          </p>
        </div>
        <div>
          <strong>客户确认</strong>
          <p>签字：___________________　日期：___________________</p>
        </div>
      </footer>

      <section className="quote-document-floors" aria-label="楼层点位图">
        {floorImages.map(({ name, src }) => (
          <figure key={name}>
            <div className="quote-document-floor-kicker">楼层点位图</div>
            <img src={src} alt={`${name} 点位方案`} />
            <figcaption>{name} · 点位方案</figcaption>
          </figure>
        ))}
      </section>
      <DocumentPrintFooter />
    </article>
  )
}

function QuoteGroup({
  groupName,
  items,
  products,
  rooms,
  onAdd,
  onUpdate,
  onRemove,
}: {
  groupName: string
  items: QuoteItem[]
  products: ProductOption[]
  rooms: string[]
  onAdd: (productId: string, room: string) => void
  onUpdate: (lineId: string, patch: Partial<QuoteItem>) => void
  onRemove: (lineId: string) => void
}) {
  const groupTotal = items.reduce((sum, item) => sum + lineTotal(item), 0)
  const defaultRoom = rooms.includes(groupName) ? groupName : rooms[0] ?? "\u5168\u5c4b"

  return (
    <div className="quote-print-card overflow-hidden rounded-md border">
      <div className="flex flex-col gap-3 border-b bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-medium">{groupName}</div>
          <div className="text-sm text-muted-foreground">{items.length} 项 / {money(groupTotal)}</div>
        </div>
        <ProductSearchDialog defaultRoom={defaultRoom} products={products} rooms={rooms} onAdd={onAdd} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>产品</TableHead>
            <TableHead className="w-36">{"\u623f\u95f4"}</TableHead>
            <TableHead className="w-16">数量</TableHead>
            <TableHead className="w-28">{"\u5355\u4ef7"}</TableHead>
            <TableHead className="w-20">折扣</TableHead>
            <TableHead className="text-right">小计</TableHead>
            <TableHead className="quote-print-hidden w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                暂无产品
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.lineId}>
                <TableCell>
                  <div className="flex min-w-48 items-center gap-3">
                    <ProductThumb product={item} />
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground" title={quoteVerification(item).reasons.join("；")}>{quoteVerificationLabel(item)}</div>
                      <div className="quote-print-value hidden text-xs text-muted-foreground">{quoteDisplaySpec(item.spec, item.name)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={item.room}
                    onValueChange={(value) => onUpdate(item.lineId, { room: value })}
                  >
                    <SelectTrigger className="quote-print-hidden h-8 w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms.map((room) => (
                        <SelectItem key={room} value={room}>
                          {room}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="quote-print-value hidden">{item.room}</span>
                </TableCell>
                <TableCell>
                  {item.pointMapProjectId ? (
                    <span className="quote-print-hidden inline-block w-16 px-2 text-right text-sm" title="数量由点位决定，删除点位即可减少">{item.quantity}</span>
                  ) : (
                    <Input
                      className="quote-print-hidden h-8 w-16 px-2 text-right"
                      min={1}
                      type="number"
                      value={item.quantity}
                      onChange={(event) =>
                        onUpdate(item.lineId, { quantity: Number(event.target.value) || 1 })
                      }
                    />
                  )}
                  <span className="quote-print-value hidden">
                    {item.quantity} {item.unit}
                  </span>
                </TableCell>
                <TableCell>
                  <Input
                    className="quote-print-hidden h-8 w-24 px-2 text-right"
                    min={0}
                    type="number"
                    value={item.price}
                    onChange={(event) =>
                      onUpdate(item.lineId, { price: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                  <span className="quote-print-value hidden">{quoteUnitPrice(item)}</span>
                </TableCell>
                <TableCell>
                  <Input
                    className="quote-print-hidden h-8 w-20 px-2 text-right"
                    min={0}
                    max={100}
                    type="number"
                    value={item.discount}
                    onChange={(event) =>
                      onUpdate(item.lineId, { discount: Number(event.target.value) || 0 })
                    }
                  />
                  <span className="quote-print-value hidden">{item.discount}%</span>
                </TableCell>
                <TableCell className="text-right font-medium">{money(lineTotal(item))}</TableCell>
                <TableCell className="quote-print-hidden">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={item.pointMapProjectId ? `删除报价及关联的 ${item.pointIds?.length ?? 0} 个点位` : `删除${item.name}报价行`}
                    title={item.pointMapProjectId ? "保存时同时删除关联安装点与场景引用" : "删除报价行"}
                    onClick={() => onRemove(item.lineId)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ProductSearchDialog({
  defaultRoom,
  products,
  rooms,
  onAdd,
}: {
  defaultRoom: string
  products: ProductOption[]
  rooms: string[]
  onAdd: (productId: string, room: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [searchTerm, setSearchTerm] = React.useState("")
  const isComposingRef = React.useRef(false)
  const [selectedProductId, setSelectedProductId] = React.useState(products[0]?.id ?? "")
  const [selectedRoom, setSelectedRoom] = React.useState(defaultRoom)
  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? products[0]
  const normalizedQuery = searchTerm.trim().toLowerCase()
  const visibleProducts = React.useMemo(() => {
    const filtered = normalizedQuery
      ? products.filter((product) =>
          [product.name, product.spec, product.category]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery)
        )
      : products

    return filtered.slice(0, 80)
  }, [normalizedQuery, products])

  function confirmAdd() {
    if (!selectedProduct) {
      return
    }

    onAdd(selectedProduct.id, selectedRoom)
    setOpen(false)
    setQuery("")
    setSearchTerm("")
  }

  return (
    <>
      <Button type="button" size="sm" className="quote-print-hidden" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {"\u6dfb\u52a0\u4ea7\u54c1"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{"\u6dfb\u52a0\u4ea7\u54c1"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setQuery(nextValue)

                    if (!isComposingRef.current) {
                      setSearchTerm(nextValue)
                    }
                  }}
                  onCompositionStart={() => {
                    isComposingRef.current = true
                  }}
                  onCompositionEnd={(event) => {
                    isComposingRef.current = false
                    setQuery(event.currentTarget.value)
                    setSearchTerm(event.currentTarget.value)
                  }}
                  placeholder={"\u641c\u7d22\u4ea7\u54c1\u540d\u3001\u578b\u53f7\u3001\u5206\u7c7b"}
                  className="pl-9"
                />
              </div>
              <Select value={selectedRoom} onValueChange={setSelectedRoom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((room) => (
                    <SelectItem key={room} value={room}>
                      {room}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-md border">
              {visibleProducts.length > 0 ? (
                visibleProducts.map((product) => {
                  const active = product.id === selectedProduct?.id

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => setSelectedProductId(product.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50",
                        active && "bg-primary/5"
                      )}
                    >
                      <ProductThumb product={product} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{product.name}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {product.category} / {product.spec}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-medium">{productPrice(product)}</div>
                    </button>
                  )
                })
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {"\u6ca1\u6709\u627e\u5230\u5339\u914d\u4ea7\u54c1"}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {"\u53d6\u6d88"}
            </Button>
            <Button type="button" onClick={confirmAdd} disabled={!selectedProduct}>
              <Plus className="size-4" />
              {"\u52a0\u5165\u62a5\u4ef7\u5355"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RoomManager({
  rooms,
  onAdd,
  onRename,
  onDelete,
}: {
  rooms: string[]
  onAdd: (roomName: string) => void
  onRename: (oldName: string, newName: string) => void
  onDelete: (roomName: string) => void
}) {
  const [newRoom, setNewRoom] = React.useState("")

  function submitRoom() {
    onAdd(newRoom)
    setNewRoom("")
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm font-medium">{"\u623f\u95f4\u7ba1\u7406"}</div>
      <div className="grid gap-2">
        {rooms.map((room) => (
          <RoomNameEditor
            key={room}
            room={room}
            canDelete={rooms.length > 1}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          value={newRoom}
          onChange={(event) => setNewRoom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submitRoom()
            }
          }}
          placeholder={"\u65b0\u623f\u95f4\u540d\u79f0"}
        />
        <Button type="button" variant="outline" onClick={submitRoom}>
          <Plus className="size-4" />
          {"\u65b0\u589e"}
        </Button>
      </div>
    </div>
  )
}

function RoomNameEditor({
  canDelete,
  room,
  onDelete,
  onRename,
}: {
  canDelete: boolean
  room: string
  onDelete: (roomName: string) => void
  onRename: (oldName: string, newName: string) => void
}) {
  const [draft, setDraft] = React.useState(room)

  function commit() {
    const nextName = draft.trim()

    if (!nextName) {
      setDraft(room)
      return
    }

    onRename(room, nextName)
  }

  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
          if (event.key === "Escape") {
            event.preventDefault()
            setDraft(room)
            event.currentTarget.blur()
          }
        }}
        aria-label={"\u623f\u95f4\u540d\u79f0"}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onDelete(room)}
        aria-label={"\u5220\u9664\u623f\u95f4"}
        disabled={!canDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="quote-print-card">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
        <Badge variant="secondary">报价</Badge>
      </CardContent>
    </Card>
  )
}

function InfoBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function TotalLine({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <strong className={strong ? "font-semibold" : "font-medium"}>{value}</strong>
    </div>
  )
}

function ProductThumb({ product, eager = false }: { product: ProductOption; eager?: boolean }) {
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded border bg-white">
      <Image
        loading={eager ? "eager" : "lazy"}
        src={product.image}
        alt={product.name}
        fill
        unoptimized={isSvgImage(product.image)}
        className="object-contain p-1"
        sizes="48px"
      />
    </div>
  )
}
