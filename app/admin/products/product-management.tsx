"use client"

import { defaultSellingPrice } from "@/lib/product-pricing"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  ImageIcon,
  Package,
  Download,
  PackageCheck,
  PackageX,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  X,
} from "lucide-react"

import { specValueLabel } from "@/lib/device-spec-labels"
import { brandNames, modelNames, seriesNames, type ProductDictionaries } from "@/lib/product-dictionary-types"
import { PRODUCT_PLATFORMS, PRODUCT_PLATFORM_LABELS, formatProductPlatforms } from "@/lib/product-platforms"
import { formatDateTime } from "@/lib/format-datetime"
import type { AdminProduct, ProductModerationStatus } from "@/lib/product-admin-service"
import { ProductDictionariesDialog } from "@/app/admin/products/product-dictionaries-dialog"
import { CatalogLicensesDialog } from "@/app/admin/products/catalog-licenses-dialog"
import { ProductImportDialog } from "@/app/admin/products/product-import-dialog"
import { ProductSyncDialog } from "@/app/admin/products/product-sync-dialog"
import { PlatformRowActionItem, PlatformRowActions } from "@/app/admin/_components/platform-list"
import { FacetedFilter } from "@/components/common/faceted-filter"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ProductPointFilters } from "@/components/products/product-point-filters"
import { ProductVisualEditor } from "@/components/products/product-visual-editor"
import { OTHER_PRODUCT_CATEGORY, STANDARD_PRODUCT_CATEGORIES } from "@/lib/product-categories"
import { matchesProductPointFilter, type ProductPointFilter } from "@/lib/product-point-classification"
import { deviceTypes, findDeviceType, type DeviceSpecs } from "@/lib/device-types"
import { productSelectionWithDefaults, protocolOptions, capabilityOptions, type ProductSelectionFields } from "@/lib/product-selection"
import { cn } from "@/lib/utils"

type ProductDraft = Required<ProductSelectionFields> & {
  brand: string
  category: string
  channels: string
  cost: number
  description: string
  image: string
  name: string
  platform: string
  series: string
  /** 多值：一个设备常同时支持米家 + Apple Home */
  platforms: string[]
  price: number
  sku: string
  status: ProductModerationStatus
  stock: number
  tags: string
  unit: string
}

type Props = {
  dictionaries: ProductDictionaries
  initialProducts: AdminProduct[]
  reviewOnly?: boolean
}

type SortKey = "name" | "category" | "price" | "stock" | "status"
type SortDir = "asc" | "desc"
type BulkApproval = { scope: "selected" | "filtered"; products: AdminProduct[]; excluded: number }

/** 「全部批准」每次提交多少条：接口每批有上限，前端自动分批，产品多也能一次点完。 */
const BULK_APPROVE_CHUNK_SIZE = 200

const statuses: ProductModerationStatus[] = ["pending_review", "approved", "rejected", "active", "inactive"]

const emptyDraft: ProductDraft = {
  ...productSelectionWithDefaults({}),
  brand: "",
  category: OTHER_PRODUCT_CATEGORY,
  channels: "",
  cost: 0,
  description: "",
  image: "",
  name: "",
  platform: "",
  platforms: [],
  price: 0,
  series: "",
  sku: "",
  status: "pending_review",
  stock: 0,
  tags: "",
  unit: "个",
}

export function ProductManagement({ dictionaries, initialProducts, reviewOnly = false }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [visualProductId, setVisualProductId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>(reviewOnly ? ["pending_review"] : [])
  const [selectionFilter, setSelectionFilter] = useState("all")
  const [pointFilter, setPointFilter] = useState<ProductPointFilter>({ category: "all", iconId: "all" })
  const [bulkApproval, setBulkApproval] = useState<BulkApproval | null>(null)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkError, setBulkError] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [visibleCols, setVisibleCols] = useState({
    brand: true,
    review: true,
    stock: true,
  })
  const editingProduct = products.find((product) => product.id === editingProductId) ?? null

  const stats = useMemo(
    () => ({
      approved: products.filter((product) => product.status === "approved" || product.status === "active").length,
      inactive: products.filter((product) => product.status === "inactive").length,
      pending: products.filter((product) => product.status === "pending_review").length,
      total: products.length,
    }),
    [products]
  )

  const categoryOptions = useMemo(
    () =>
      STANDARD_PRODUCT_CATEGORIES.map((category) => ({
        icon: Package,
        label: category,
        value: category,
      })),
    []
  )

  const statusOptions = useMemo(
    () =>
      statuses.map((status) => ({
        icon: statusIcons[status],
        label: statusLabels[status],
        value: status,
      })),
    []
  )

  const catalogFilteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = products.filter((product) => {
      const category = product.category ?? OTHER_PRODUCT_CATEGORY
      const matchesSearch =
        query.length === 0 ||
        [product.name, product.sku, product.brand, product.platform, formatProductPlatforms(product.platforms), product.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      const matchesCategory = categoryFilter.length === 0 || categoryFilter.includes(category)
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(product.status)

      const matchesSelection = selectionFilter === "all" ||
        (selectionFilter === "pending" && (product.catalogKind === "legacy" || product.selectionStatus === "pending")) ||
        (selectionFilter === "series" && product.catalogKind === "series") ||
        (selectionFilter === "sku" && product.catalogKind === "sku") ||
        (selectionFilter === "conflict" && product.selectionStatus === "conflict") ||
        (selectionFilter === "price" && product.pricingStatus !== "verified")
      return matchesSearch && matchesCategory && matchesStatus && matchesSelection
    })

    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "zh-Hans-CN")

      return sortDir === "asc" ? cmp : -cmp
    })
  }, [categoryFilter, products, search, sortDir, sortKey, statusFilter, selectionFilter])

  const filteredProducts = useMemo(
    () => catalogFilteredProducts.filter((product) => matchesProductPointFilter(product, pointFilter)),
    [catalogFilteredProducts, pointFilter]
  )

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pagedProducts = filteredProducts.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
  const selectedOnPage = pagedProducts.length > 0 && pagedProducts.every((product) => selected.has(product.id))
  const isFiltered = pointFilter.category !== "all" || pointFilter.iconId !== "all" || selectionFilter !== "all" || search.length > 0 || categoryFilter.length > 0 || (!reviewOnly && statusFilter.length > 0)
  const tableColumnCount = 5 + Number(visibleCols.brand) + Number(visibleCols.stock) + Number(visibleCols.review)
  const selectedProducts = products.filter((product) => selected.has(product.id))
  const selectedPendingProducts = selectedProducts.filter((product) => product.status === "pending_review")
  const filteredPendingProducts = filteredProducts.filter((product) => product.status === "pending_review")
  const batchBusy = bulkApproving || savingId === "batch"

  async function refresh() {
    try {
      const response = await fetch(reviewOnly ? "/api/admin/products?status=pending_review" : "/api/admin/products")
      const data = await response.json()
      if (!response.ok) throw new Error("列表刷新失败，请稍后重试")
      setProducts(data.products)
      return true
    } catch {
      setMessage("列表刷新失败，请稍后重试")
      return false
    }
  }

  async function createProduct() {
    setMessage("")
    const response = await fetch("/api/admin/products", {
      body: JSON.stringify(toPayload(draft)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.details ? Object.values(data.details).join("; ") : "创建失败")
      return
    }
    setProducts((current) => [data.product, ...current])
    setDraft(emptyDraft)
    setMessage("产品已创建")
  }

  async function updateProduct(product: AdminProduct) {
    setSavingId(product.id)
    setMessage("")
    const response = await fetch(`/api/admin/products/${product.id}`, {
      body: JSON.stringify(product),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
    const data = await response.json()
    setSavingId(null)
    if (!response.ok) {
      setMessage(data.details ? Object.values(data.details).join("; ") : "保存失败")
      if (data.details?.mappingRevision) await refresh()
      return
    }
    setProducts((current) => current.map((item) => (item.id === product.id ? data.product : item)))
    setMessage("产品已保存")
  }

  async function review(product: AdminProduct, status: "approved" | "rejected") {
    const note = status === "rejected" ? window.prompt("驳回原因") : ""
    if (status === "rejected" && !note) return

    const response = await fetch(`/api/admin/products/${product.id}/review`, {
      body: JSON.stringify({ note, status }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.details ? Object.values(data.details).join("; ") : "审核失败")
      return
    }
    setProducts((current) =>
      reviewOnly
        ? current.filter((item) => item.id !== product.id)
        : current.map((item) => (item.id === product.id ? data.product : item))
    )
    setMessage(status === "approved" ? "产品已通过审核" : "产品已驳回")
  }

  async function deactivate(product: AdminProduct) {
    const response = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" })
    const data = await response.json()
    if (response.ok) {
      setProducts((current) => current.map((item) => (item.id === product.id ? data.product : item)))
      setMessage("产品已停用")
      return
    }
    setMessage(data.details ? Object.values(data.details).join("; ") : "停用失败")
  }

  async function saveProductPatch(productId: string, patch: Partial<AdminProduct>) {
    const product = products.find((item) => item.id === productId)
    if (!product) return

    patchProduct(productId, patch)
    await updateProduct({ ...product, ...patch })
  }

  function prepareBulkApproval(scope: BulkApproval["scope"]) {
    const candidates = scope === "selected" ? selectedProducts : filteredProducts
    const pending = candidates.filter((product) => product.status === "pending_review")
    if (pending.length === 0 || batchBusy) return
    setBulkError("")
    setBulkApproval({ scope, products: pending, excluded: candidates.length - pending.length })
  }

  async function approveProducts() {
    if (!bulkApproval || bulkApproving) return
    setBulkApproving(true)
    setBulkError("")
    setMessage("")
    try {
      // 接口每批有上限（防止一次请求拖死），但产品多的库（比如 700+ 条）不该逼操作者
      // 手动分批。这里自动切片、顺序提交，边提交边更新列表让操作者看到进度。
      const targets = bulkApproval.products.map(({ id, mappingRevision }) => ({ id, mappingRevision }))
      const approvedIds = new Map<string, AdminProduct>()
      let approved = 0
      let skipped = 0
      for (let start = 0; start < targets.length; start += BULK_APPROVE_CHUNK_SIZE) {
        const chunk = targets.slice(start, start + BULK_APPROVE_CHUNK_SIZE)
        const done = Math.min(start + BULK_APPROVE_CHUNK_SIZE, targets.length)
        setMessage(`正在批准 ${done}/${targets.length}…`)
        const response = await fetch("/api/admin/products/bulk-review", {
          body: JSON.stringify({ products: chunk }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.details ? Object.values(data.details).join("；") : "批准失败，请刷新列表后重试")
        }
        approved += Number(data.approved ?? 0)
        skipped += Number(data.skipped ?? 0)
        for (const product of (data.products ?? []) as AdminProduct[]) approvedIds.set(product.id, product)
        setProducts((current) => current.map((product) => approvedIds.get(product.id) ?? product))
      }
      const summary = `已批准 ${approved} 件产品${skipped ? `，另有 ${skipped} 件已批准产品跳过` : ""}，参数与价格核验状态保持不变。`
      const updatedProducts = approvedIds
      setProducts((current) => current.flatMap((product) => {
        const updated = updatedProducts.get(product.id) ?? product
        return reviewOnly && updated.status !== "pending_review" ? [] : [updated]
      }))
      setSelected(new Set())
      setBulkApproval(null)
      setMessage(summary)
      toast.success(summary)
      if (!(await refresh())) {
        setMessage(`${summary} 列表刷新失败，可稍后点击刷新。`)
        toast.warning("审批已保存，列表刷新失败，可稍后点击刷新。")
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "批准失败，请稍后重试"
      setBulkError(description)
      setMessage(description)
      toast.error(description)
    } finally {
      setBulkApproving(false)
    }
  }

  async function deactivateSelectedProducts() {
    if (selectedProducts.length === 0) return

    setSavingId("batch")
    for (const product of selectedProducts) {
      await deactivate(product)
    }
    setSelected(new Set())
    setSavingId(null)
    setMessage(`已停用 ${selectedProducts.length} 件产品`)
  }

  function patchProduct(productId: string, patch: Partial<AdminProduct>) {
    setProducts((current) => current.map((product) => {
      if (product.id !== productId) return product
      const next = { ...product, ...patch }
      const intentChanged = ["catalogKind", "deviceTypeId", "parentProductId", "manufacturerModel", "specs", "protocols", "capabilities", "sku", "platform", "platforms", "unit"].some((key) => Object.hasOwn(patch, key))
      if (intentChanged) { next.selectionStatus = "pending"; next.pricingStatus = "pending" }
      if (Object.hasOwn(patch, "price") || Object.hasOwn(patch, "cost")) next.pricingStatus = "pending"
      return next
    }))
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  function resetFilters() {
    setSearch("")
    setSelectionFilter("all")
    setPointFilter({ category: "all", iconId: "all" })
    setCategoryFilter([])
    setStatusFilter(reviewOnly ? ["pending_review"] : [])
    setPage(0)
  }

  function toggleAllOnPage(checked: boolean) {
    const next = new Set(selected)
    pagedProducts.forEach((product) => {
      if (checked) next.add(product.id)
      else next.delete(product.id)
    })
    setSelected(next)
  }

  function toggleRow(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-semibold">{reviewOnly ? "产品审核" : "产品管理"}</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={batchBusy} onClick={() => void refresh()}>
            <RefreshCw />
            刷新
          </Button>
          {!reviewOnly ? <CatalogLicensesDialog /> : null}
          {!reviewOnly ? <ProductDictionariesDialog initial={dictionaries} /> : null}
          {!reviewOnly ? <ProductImportDialog onImported={refresh} /> : null}
          {!reviewOnly ? <ProductSyncDialog onImported={refresh} /> : null}
          {!reviewOnly ? (
            // 普通 <a>：响应带 Content-Disposition，浏览器直接落文件；同源请求自带登录态。
            <Button variant="outline" asChild>
              <a href="/api/admin/products/export" download>
                <Download />
                导出表格
              </a>
            </Button>
          ) : null}
          {!reviewOnly ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button disabled={batchBusy}>
                  <Plus />
                  新建产品
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>新建产品</DialogTitle>
                </DialogHeader>
                <ProductForm dictionaries={dictionaries} draft={draft} products={products} onChange={(patch) => setDraft({ ...draft, ...patch })} />
                {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
                <Button onClick={createProduct}>
                  <Save />
                  保存产品
                </Button>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      {message ? <div role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="总数" value={stats.total} />
        <Metric label="待审核" value={stats.pending} />
        <Metric label="已通过" value={stats.approved} />
        <Metric label="已停用" value={stats.inactive} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>{reviewOnly ? "待审核产品" : "产品列表"}</CardTitle>
              <CardDescription>按产品名称、SKU、分类、品牌和审核状态管理平台产品库；也可按点位图类别和图标筛选。</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={batchBusy || filteredPendingProducts.length === 0} onClick={() => prepareBulkApproval("filtered")}>
                <PackageCheck className="size-4" />
                全部批准加入产品库（{filteredPendingProducts.length}）
              </Button>
              {selected.size > 0 ? (
                <>
                <Badge variant="secondary">已选择 {selected.size} 件</Badge>
                <Button variant="outline" size="sm" disabled={batchBusy || selectedPendingProducts.length === 0} onClick={() => prepareBulkApproval("selected")}>
                  <Check className="size-4" />
                  批准选中（{selectedPendingProducts.length}）
                </Button>
                <Button variant="outline" size="sm" disabled={batchBusy} onClick={() => void deactivateSelectedProducts()}>
                  <PauseCircle className="size-4" />
                  批量停用
                </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
                placeholder="搜索产品、SKU、品牌或平台"
                className="h-9 w-full max-w-64"
              />
              <FacetedFilter
                title="分类"
                options={categoryOptions}
                selected={categoryFilter}
                onChange={(value) => {
                  setCategoryFilter(value)
                  setPage(0)
                }}
              />
              <FacetedFilter
                title="状态"
                options={statusOptions}
                selected={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value)
                  setPage(0)
                }}
              />
              <Select value={selectionFilter} onValueChange={(value) => { setSelectionFilter(value); setPage(0) }}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部选型资料</SelectItem>
                  <SelectItem value="pending">待整理 / 待核</SelectItem>
                  <SelectItem value="sku">具体 SKU</SelectItem>
                  <SelectItem value="series">产品系列</SelectItem>
                  <SelectItem value="conflict">参数冲突</SelectItem>
                  <SelectItem value="price">价格待核</SelectItem>
                </SelectContent>
              </Select>
              {isFiltered ? (
                <Button variant="ghost" size="sm" className="h-9 px-2" onClick={resetFilters}>
                  重置
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Settings2 className="size-4" />
                  列显示
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>显示字段</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(
                  [
                    ["brand", "品牌/平台"],
                    ["stock", "库存"],
                    ["review", "审核"],
                  ] as const
                ).map(([key, label]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={visibleCols[key]}
                    onCheckedChange={(value) =>
                      setVisibleCols((current) => ({
                        ...current,
                        [key]: !!value,
                      }))
                    }
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ProductPointFilters
            products={catalogFilteredProducts}
            value={pointFilter}
            onChange={(value) => { setPointFilter(value); setPage(0) }}
          />
          <p className="text-xs text-muted-foreground">
            “全部批准”处理当前全部筛选结果中的待审核产品，包含其他分页。批准后将在产品库显示；参数与价格核验状态保持原值。
          </p>

          <div className="overflow-hidden rounded-lg bg-muted/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedOnPage}
                      disabled={batchBusy}
                      onCheckedChange={(value) => toggleAllOnPage(!!value)}
                      aria-label="选择当前页产品"
                    />
                  </TableHead>
                  <TableHead>
                    <SortButton label="产品" active={sortKey === "name"} onClick={() => toggleSort("name")} />
                  </TableHead>
                  <TableHead className="w-36">
                    <SortButton label="分类" active={sortKey === "category"} onClick={() => toggleSort("category")} />
                  </TableHead>
                  {visibleCols.brand ? <TableHead>品牌/平台</TableHead> : null}
                  <TableHead className="w-32">
                    <SortButton label="价格" active={sortKey === "price"} onClick={() => toggleSort("price")} />
                  </TableHead>
                  {visibleCols.stock ? (
                    <TableHead className="w-28">
                      <SortButton label="库存" active={sortKey === "stock"} onClick={() => toggleSort("stock")} />
                    </TableHead>
                  ) : null}
                  <TableHead className="w-36">
                    <SortButton label="状态" active={sortKey === "status"} onClick={() => toggleSort("status")} />
                  </TableHead>
                  {visibleCols.review ? <TableHead className="w-48">审核</TableHead> : null}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={tableColumnCount} className="h-28 text-center text-muted-foreground">
                      没有匹配的产品。
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedProducts.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      selected={selected.has(product.id)}
                      disabled={batchBusy}
                      reviewOnly={reviewOnly}
                      visibleCols={visibleCols}
                      onSelect={(value) => toggleRow(product.id, value)}
                      onPatch={(patch) => void saveProductPatch(product.id, patch)}
                      onEdit={() => setEditingProductId(product.id)}
                      onVisualEdit={() => setVisualProductId(product.id)}
                      onDeactivate={() => deactivate(product)}
                      onReview={(status) => review(product, status)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              已选择 {selected.size} 件，共 {filteredProducts.length} 件匹配产品
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">每页</p>
                <Select
                  value={`${pageSize}`}
                  onValueChange={(value) => {
                    setPageSize(Number(value))
                    setPage(0)
                  }}
                >
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 50].map((size) => (
                      <SelectItem key={size} value={`${size}`}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm font-medium">
                第 {currentPage + 1} / {pageCount} 页
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden size-8 lg:flex"
                  onClick={() => setPage(0)}
                  disabled={currentPage === 0}
                  aria-label="第一页"
                >
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  aria-label="上一页"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="下一页"
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="hidden size-8 lg:flex"
                  onClick={() => setPage(pageCount - 1)}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="最后一页"
                >
                  <ChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={bulkApproval !== null} onOpenChange={(open) => { if (!open && !bulkApproving) setBulkApproval(null) }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" aria-describedby="bulk-approval-description">
          <DialogHeader>
            <DialogTitle>{bulkApproval?.scope === "selected" ? "批准选中的待审核产品" : "全部批准加入产品库"}</DialogTitle>
          </DialogHeader>
          {bulkApproval ? <>
            <p id="bulk-approval-description" className="text-sm text-muted-foreground">
              本次将批准 {bulkApproval.products.length} 件待审核产品
              {bulkApproval.scope === "filtered" ? "，范围为当前筛选结果的全部分页" : "，范围为已勾选的产品"}。
              {bulkApproval.excluded > 0 ? `另有 ${bulkApproval.excluded} 件非待审核产品不作更改。` : ""}
              参数与价格核验状态保持原值；尚待核验的资料仍需补齐依据。
            </p>
            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3 text-sm" aria-label="本次批准产品">
              {bulkApproval.products.map((product) => <li key={product.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span>{product.name}</span><span className="text-muted-foreground">{product.sku}</span>
              </li>)}
            </ul>
            {bulkError ? <p role="alert" className="text-sm text-destructive">{bulkError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={bulkApproving} onClick={() => setBulkApproval(null)}>取消</Button>
              <Button disabled={bulkApproving} onClick={() => void approveProducts()}>
                <PackageCheck />{bulkApproving ? "正在批准…" : `确认批准 ${bulkApproval.products.length} 件`}
              </Button>
            </div>
          </> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingProduct)} onOpenChange={(open) => !open && setEditingProductId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>编辑产品</DialogTitle>
          </DialogHeader>
          {editingProduct ? (
            <>
              <ProductForm
                dictionaries={dictionaries}
                draft={productToDraft(editingProduct)}
                products={products.filter((product) => product.id !== editingProduct.id)}
                onChange={(patch) => patchProduct(editingProduct.id, draftPatchToProduct(patch))}
              />
              {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
              <Button disabled={savingId === editingProduct.id} onClick={() => updateProduct(editingProduct)}>
                <Save />
                保存
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <ProductVisualEditor product={products.find((product) => product.id === visualProductId) ?? null} onClose={() => setVisualProductId(null)} />
    </div>
  )
}

function ProductForm({ dictionaries, draft, onChange, products }: { dictionaries: ProductDictionaries; draft: ProductDraft; onChange: (patch: Partial<ProductDraft>) => void; products: AdminProduct[] }) {
  const deviceType = findDeviceType(draft.deviceTypeId)
  function setSpec(key: string, value: string | number | boolean | undefined) {
    const specs: DeviceSpecs = { ...draft.specs }
    if (value === undefined) delete specs[key]
    else specs[key] = value
    onChange({ specs })
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
        系列只整理供货范围；具体 SKU 经参数核验后用于点位选型。修改已核关键参数或价格后，需要重新核验。
      </div>
      <Field label="资料身份">
        <Select value={draft.catalogKind} onValueChange={(catalogKind) => onChange({ catalogKind: catalogKind as ProductDraft["catalogKind"], parentProductId: null })}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="legacy">旧资料待整理</SelectItem><SelectItem value="series">产品系列</SelectItem><SelectItem value="sku">具体 SKU</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="设备类型">
        <Select value={draft.deviceTypeId || "unknown"} onValueChange={(deviceTypeId) => onChange({ deviceTypeId: deviceTypeId === "unknown" ? null : deviceTypeId, category: findDeviceType(deviceTypeId)?.category ?? draft.category, specs: {}, selectionStatus: "pending", pricingStatus: "pending" })}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="unknown">待确认</SelectItem>
            {deviceTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {draft.catalogKind === "sku" ? <Field label="所属系列（可选）">
        <Select value={draft.parentProductId || "none"} onValueChange={(parentProductId) => onChange({ parentProductId: parentProductId === "none" ? null : parentProductId })}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">独立 SKU</SelectItem>
            {products.filter((product) => product.catalogKind === "series" && (!draft.deviceTypeId || !product.deviceTypeId || draft.deviceTypeId === product.deviceTypeId)).map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field> : null}
      <Field label="厂商型号">
        <Select
          value={draft.manufacturerModel || "__none"}
          onValueChange={(value) => onChange({ manufacturerModel: value === "__none" ? null : value })}
        >
          <SelectTrigger><SelectValue placeholder="从字典选择" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">未填</SelectItem>
            {modelNames(dictionaries, draft.brand, draft.series, draft.manufacturerModel).map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="名称">
        <Input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <Field label="SKU">
        <Input value={draft.sku} onChange={(event) => onChange({ sku: event.target.value })} />
      </Field>
      <Field label="品牌">
        <Select
          value={draft.brand || "__none"}
          onValueChange={(value) => onChange({ brand: value === "__none" ? "" : value, manufacturerModel: null, series: "" })}
        >
          <SelectTrigger><SelectValue placeholder="从字典选择" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">未填</SelectItem>
            {brandNames(dictionaries, draft.brand).map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="系列">
        <Select
          value={draft.series || "__none"}
          onValueChange={(value) => onChange({ series: value === "__none" ? "" : value })}
        >
          <SelectTrigger><SelectValue placeholder="从字典选择" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">未填</SelectItem>
            {seriesNames(dictionaries, draft.brand, draft.series).map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="生态平台（可多选）">
        <div className="flex flex-wrap gap-2">
          {PRODUCT_PLATFORMS.map((value) => {
            const active = draft.platforms.includes(value)
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ platforms: active ? draft.platforms.filter((item) => item !== value) : [...draft.platforms, value] })}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40"}`}
              >
                {PRODUCT_PLATFORM_LABELS[value]}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="分类">
        <Select value={draft.category || OTHER_PRODUCT_CATEGORY} onValueChange={(category) => onChange({ category })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STANDARD_PRODUCT_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {deviceType ? <div className="grid gap-4 rounded-md border p-3 sm:col-span-2 sm:grid-cols-2">
        <p className="text-sm text-muted-foreground sm:col-span-2">{deviceType.name}参数（留空表示未知；* 为核验必需）</p>
        {deviceType.specs.map((spec) => <Field key={spec.key} label={`${spec.name}${spec.unit ? ` (${spec.unit})` : ""}${spec.required ? " *" : ""}`}>
          {spec.type === "boolean" || spec.values ? <Select value={draft.specs[spec.key] === undefined ? "unknown" : String(draft.specs[spec.key])} onValueChange={(value) => setSpec(spec.key, value === "unknown" ? undefined : spec.type === "boolean" ? value === "true" : value)}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem>
              {spec.type === "boolean" ? <><SelectItem value="true">是</SelectItem><SelectItem value="false">否</SelectItem></> : spec.values?.map((value) => <SelectItem key={value} value={value}>{specValueLabel(value) ?? value}</SelectItem>)}
            </SelectContent>
          </Select> : <Input type={spec.type === "number" ? "number" : "text"} min={spec.min} max={spec.max} step={spec.integer ? 1 : "any"} value={String(draft.specs[spec.key] ?? "")} onChange={(event) => setSpec(spec.key, event.target.value === "" ? undefined : spec.type === "number" ? Number(event.target.value) : event.target.value)} />}
        </Field>)}
      </div> : null}
      <div className="grid gap-3 rounded-md border p-3 sm:col-span-2">
        <p className="text-sm font-medium">通信协议</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{protocolOptions.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.protocols.includes(option.value)} onCheckedChange={(checked) => onChange({ protocols: checked ? [...draft.protocols, option.value] : draft.protocols.filter((value) => value !== option.value) })} />{option.label}</label>)}</div>
        <p className="mt-2 text-sm font-medium">设备能力</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{capabilityOptions.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.capabilities.includes(option.value)} onCheckedChange={(checked) => onChange({ capabilities: checked ? [...draft.capabilities, option.value] : draft.capabilities.filter((value) => value !== option.value) })} />{option.label}</label>)}</div>
      </div>
      <Field label="参数核验">
        <Select value={draft.selectionStatus} onValueChange={(selectionStatus) => onChange({ selectionStatus: selectionStatus as ProductDraft["selectionStatus"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">待核验</SelectItem><SelectItem value="verified">已核验</SelectItem><SelectItem value="conflict">资料冲突</SelectItem></SelectContent>
        </Select>
      </Field>
      <Field label="参数依据 / 来源"><Textarea value={draft.selectionEvidence ?? ""} placeholder="资料名称、页码、适用型号与核验结论" onChange={(event) => onChange({ selectionEvidence: event.target.value })} /></Field>
      <Field label="价格核验">
        <Select value={draft.pricingStatus} onValueChange={(pricingStatus) => onChange({ pricingStatus: pricingStatus as ProductDraft["pricingStatus"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">价格待核</SelectItem><SelectItem value="verified">价格已核（含已核零价）</SelectItem><SelectItem value="conflict">价格冲突</SelectItem></SelectContent>
        </Select>
      </Field>
      <Field label="价格依据 / 来源"><Textarea value={draft.pricingEvidence ?? ""} placeholder="渠道、日期、规格、人工核价依据" onChange={(event) => onChange({ pricingEvidence: event.target.value })} /></Field>
      <Field label="商品图片">
        <Input aria-label="商品图片地址" value={draft.image} placeholder="图片网址或 /assets/products/…" onChange={(event) => onChange({ image: event.target.value })} />
        <p className="text-xs text-muted-foreground">使用对应型号的清晰产品图。历史报价保留原图片快照。</p>
        {draft.image.trim() ? <img src={draft.image} alt="商品图片预览" className="size-28 rounded-lg bg-slate-50 object-contain p-2" /> : null}
      </Field>
      <Field label="价格">
        <Input type="number" value={draft.price} onChange={(event) => onChange({ price: Number(event.target.value) })} />
      </Field>
      <Field label="成本">
        <Input type="number" value={draft.cost} onChange={(event) => onChange({ cost: Number(event.target.value) })} />
      </Field>
      <Field label="库存">
        <Input type="number" value={draft.stock} onChange={(event) => onChange({ stock: Number(event.target.value) })} />
      </Field>
      <Field label="单位">
        <Input value={draft.unit} onChange={(event) => onChange({ unit: event.target.value })} />
      </Field>
      <Field label="标签">
        <Input value={draft.tags} onChange={(event) => onChange({ tags: event.target.value })} />
      </Field>
      <Field label="渠道">
        <Input value={draft.channels} onChange={(event) => onChange({ channels: event.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="描述">
          <Textarea value={draft.description} onChange={(event) => onChange({ description: event.target.value })} />
        </Field>
      </div>
    </div>
  )
}

function SortButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 px-2", active ? "text-foreground" : "text-muted-foreground")}
      onClick={onClick}
    >
      {label}
      <ArrowUpDown className="size-3.5" />
    </Button>
  )
}

function ProductRow({
  onDeactivate,
  onEdit,
  onVisualEdit,
  onPatch,
  onReview,
  onSelect,
  product,
  reviewOnly,
  selected,
  disabled,
  visibleCols,
}: {
  onDeactivate: () => void
  onEdit: () => void
  onVisualEdit: () => void
  onPatch: (patch: Partial<AdminProduct>) => void
  onReview: (status: "approved" | "rejected") => void
  onSelect: (value: boolean) => void
  product: AdminProduct
  reviewOnly: boolean
  selected: boolean
  disabled: boolean
  visibleCols: { brand: boolean; review: boolean; stock: boolean }
}) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox checked={selected} disabled={disabled} onCheckedChange={(value) => onSelect(!!value)} aria-label={`选择 ${product.name}`} />
      </TableCell>
      <TableCell>
        <div className="font-medium">{product.name}</div>
        <div className="text-xs text-muted-foreground">{product.sku}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline">{product.catalogKind === "sku" ? "具体 SKU" : product.catalogKind === "series" ? "系列" : "待整理"}</Badge>
          <Badge variant={product.selectionStatus === "conflict" ? "destructive" : "secondary"}>{product.selectionStatus === "verified" ? "参数已核" : product.selectionStatus === "conflict" ? "参数冲突" : "参数待核"}</Badge>
          {product.pricingStatus !== "verified" ? <Badge variant="outline">价格待核</Badge> : null}
        </div>
      </TableCell>
      <TableCell>
        <div>{product.category ?? "未分类"}</div>
        <div className="text-xs text-muted-foreground">{product.unit}</div>
      </TableCell>
      {visibleCols.brand ? (
        <TableCell>
          <div>{product.brand ?? "未设置"}</div>
          <div className="text-xs text-muted-foreground">{formatProductPlatforms(product.platforms, product.platform ?? "未设置平台")}</div>
        </TableCell>
      ) : null}
      <TableCell>
        <div>{formatCny(defaultSellingPrice(product.price, product.cost))}</div>
        <div className="text-xs text-muted-foreground">成本 {formatCny(product.cost)}</div>
      </TableCell>
      {visibleCols.stock ? <TableCell>{product.stock}</TableCell> : null}
      <TableCell>
        {reviewOnly ? (
          <StatusBadge status={product.status} />
        ) : (
          <Select disabled={disabled} value={product.status} onValueChange={(value) => onPatch({ status: value as ProductModerationStatus })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabels[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      {visibleCols.review ? (
        <TableCell className="max-w-48 text-sm text-muted-foreground">
          {product.reviewedAt ? formatDateTime(product.reviewedAt) : "未审核"}
          {product.reviewNote ? <div className="truncate">{product.reviewNote}</div> : null}
        </TableCell>
      ) : null}
      <TableCell>
        <div className="flex justify-end" inert={disabled} aria-disabled={disabled}>
          <PlatformRowActions>
            <PlatformRowActionItem onClick={() => onReview("approved")}>
              <Check />
              通过
            </PlatformRowActionItem>
            <PlatformRowActionItem onClick={() => onReview("rejected")}>
              <X />
              驳回
            </PlatformRowActionItem>
            {!reviewOnly ? (
              <>
                <PlatformRowActionItem onClick={onEdit}>
                  <Pencil />
                  编辑
                </PlatformRowActionItem>
                <PlatformRowActionItem onClick={onVisualEdit}>
                  <ImageIcon />
                  展示图片
                </PlatformRowActionItem>
                <PlatformRowActionItem onClick={onDeactivate}>
                  <PauseCircle />
                  停用
                </PlatformRowActionItem>
              </>
            ) : null}
          </PlatformRowActions>
        </div>
      </TableCell>
    </TableRow>
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

function StatusBadge({ status }: { status: ProductModerationStatus }) {
  const variant = status === "approved" || status === "active" ? "secondary" : status === "rejected" ? "destructive" : "outline"
  return <Badge variant={variant}>{statusLabels[status]}</Badge>
}

function formatCny(value: number) {
  return `￥${value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`
}

const statusLabels: Record<ProductModerationStatus, string> = {
  active: "启用",
  approved: "已通过",
  inactive: "已停用",
  pending_review: "待审核",
  rejected: "已驳回",
}

const statusIcons: Record<ProductModerationStatus, typeof Clock3> = {
  active: PackageCheck,
  approved: CheckCircle2,
  inactive: PackageX,
  pending_review: Clock3,
  rejected: X,
}

function sortValue(product: AdminProduct, key: SortKey) {
  if (key === "price") return defaultSellingPrice(product.price, product.cost)
  if (key === "stock") return product.stock
  if (key === "category") return product.category ?? ""
  if (key === "status") return statusLabels[product.status]
  return product.name
}

function productToDraft(product: AdminProduct): ProductDraft {
  return {
    ...product,
    brand: product.brand ?? "",
    category: product.category ?? OTHER_PRODUCT_CATEGORY,
    channels: product.channels.join(", "),
    cost: product.cost,
    description: product.description ?? "",
    image: product.image ?? "",
    name: product.name,
    platform: product.platform ?? "",
    platforms: product.platforms ?? (product.platform ? [product.platform] : []),
    series: product.series ?? "",
    price: product.price,
    sku: product.sku,
    status: product.status,
    stock: product.stock,
    tags: product.tags.join(", "),
    unit: product.unit,
  }
}

function draftPatchToProduct(patch: Partial<ProductDraft>): Partial<AdminProduct> {
  const productPatch: Partial<AdminProduct> = {}
  for (const key of ["catalogKind", "deviceTypeId", "parentProductId", "manufacturerModel", "specs", "protocols", "capabilities", "selectionStatus", "selectionEvidence", "pricingStatus", "pricingEvidence"] as const) {
    if (patch[key] !== undefined) Object.assign(productPatch, { [key]: patch[key] })
  }

  if (patch.brand !== undefined) productPatch.brand = patch.brand
  if (patch.category !== undefined) productPatch.category = patch.category
  if (patch.cost !== undefined) productPatch.cost = patch.cost
  if (patch.description !== undefined) productPatch.description = patch.description
  if (patch.image !== undefined) productPatch.image = patch.image
  if (patch.name !== undefined) productPatch.name = patch.name
  if (patch.platform !== undefined) productPatch.platform = patch.platform
  if (patch.platforms !== undefined) productPatch.platforms = patch.platforms
  if (patch.series !== undefined) productPatch.series = patch.series
  if (patch.price !== undefined) productPatch.price = patch.price
  if (patch.sku !== undefined) productPatch.sku = patch.sku
  if (patch.status !== undefined) productPatch.status = patch.status
  if (patch.stock !== undefined) productPatch.stock = patch.stock
  if (patch.unit !== undefined) productPatch.unit = patch.unit

  if (typeof patch.channels === "string") {
    productPatch.channels = splitList(patch.channels)
  }

  if (typeof patch.tags === "string") {
    productPatch.tags = splitList(patch.tags)
  }

  return productPatch
}

function toPayload(draft: ProductDraft) {
  return {
    ...draft,
    channels: splitList(draft.channels),
    tags: splitList(draft.tags),
  }
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

