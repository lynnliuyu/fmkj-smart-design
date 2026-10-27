"use client";

import Image from "next/image";
import { needsDirectImageLoad } from "@/lib/image-src";
import * as React from "react";
import {
  Check,
  Copy,
  FileSpreadsheet,
  Grid2X2,
  List,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ManagementBar } from "@/components/animate-ui/management-bar";
import {
  pointFilterLabel,
  ProductPointBadge,
  ProductPointFilters,
} from "@/components/products/product-point-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { fallbackProducts } from "@/lib/fallback-products";
import { addQuoteDraftProduct } from "@/lib/quote-draft";
import { quoteProjects, quoteRooms } from "@/lib/quote-options";
import { productSelectionWithDefaults, type ProductSelectionFields } from "@/lib/product-selection";
import { findDeviceType } from "@/lib/device-types";
import { ALL_POINT_PRODUCTS, matchesProductPointFilter } from "@/lib/product-point-classification";
import { cn } from "@/lib/utils";
import type { ProductVisualAsset } from "@/lib/product-visual-assets";

type Product = Partial<ProductSelectionFields> & {
  id?: string;
  name: string;
  brand: string;
  platform: string;
  category: string;
  sku: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  image: string;
  visualAsset?: ProductVisualAsset | null;
  description: string;
  tags: string[];
  channels: string[];
  status: "active" | "approved" | "inactive" | "pending_review" | "rejected";
};

type Facet = {
  label: string;
  value: string;
  type: "platform" | "brand" | "category" | "tag";
};

/** 每页产品数：足够一屏浏览，又不会一次渲染上千张卡。 */
const PRODUCT_PAGE_SIZE = 24;

export function ProductLibrary({
  canManageProducts = false,
}: {
  canManageProducts?: boolean;
} = {}) {
  const [databaseProducts, setDatabaseProducts] = React.useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = React.useState(true);
  const [productLoadError, setProductLoadError] = React.useState("");
  const [productSource, setProductSource] = React.useState("");
  const [facet, setFacet] = React.useState<Facet | null>(null);
  const [pointFilter, setPointFilter] = React.useState(ALL_POINT_PRODUCTS);
  const [query, setQuery] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  // 产品库目前有 700+ 条记录，全部渲染会让页面超过 10 万像素；按页渲染。
  const [pageSize, setPageSize] = React.useState(PRODUCT_PAGE_SIZE);
  const [pageSelection, setPageSelection] = React.useState({ key: "", index: 0 });
  // 产品库的 facet 与设备图标一共 90 多个 chip，默认只露出平台，其余按需展开。
  const [showAllFilters, setShowAllFilters] = React.useState(false);
  const isComposingRef = React.useRef(false);
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);
  const [quoteProduct, setQuoteProduct] = React.useState<Product | null>(null);
  const [quoteProject, setQuoteProject] = React.useState(quoteProjects[0] ?? "");
  const [quoteRoom, setQuoteRoom] = React.useState("全屋");
  const [selectedProductKeys, setSelectedProductKeys] = React.useState<
    Set<string>
  >(() => new Set());
  const [duplicatingProductKey, setDuplicatingProductKey] = React.useState("");

  const usingFallbackProducts =
    !isLoadingProducts &&
    databaseProducts.length === 0 &&
    Boolean(productLoadError);
  const catalogProducts = usingFallbackProducts
    ? fallbackProducts
    : databaseProducts;
  const platforms = unique(catalogProducts.map((product) => product.platform));
  const brands = unique(catalogProducts.map((product) => product.brand));
  const categories = unique(catalogProducts.map((product) => product.category));
  const totalProducts = catalogProducts.length;

  React.useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        const response = await fetch("/api/products", { cache: "no-store" });
        const payload = (await response.json()) as {
          data?: Product[];
          error?: string;
          source?: string;
        };
        const nextProducts =
          payload.data?.map(normalizeProduct).filter(isProduct) ?? [];

        if (active) {
          setDatabaseProducts(nextProducts);
          setProductSource(payload.source ?? "");
          setProductLoadError(
            response.ok && !payload.source?.includes("fallback")
              ? ""
              : (payload.error ?? "PRODUCTS_UNAVAILABLE"),
          );
          setSelectedProduct((current) => current ?? nextProducts[0] ?? null);
        }
      } catch {
        if (active) {
          setDatabaseProducts([]);
          setProductSource("");
          setProductLoadError("PRODUCTS_UNAVAILABLE");
        }
      } finally {
        if (active) {
          setIsLoadingProducts(false);
        }
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, []);

  const catalogFilteredProducts = React.useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return catalogProducts.filter((product) => {
      const matchesFacet =
        !facet || (facet.type !== "tag" && product[facet.type] === facet.value);
      const matchesQuery =
        keyword.length === 0 ||
        productSearchText(product).toLowerCase().includes(keyword);

      return matchesFacet && matchesQuery;
    });
  }, [catalogProducts, facet, searchTerm]);

  const filteredProducts = React.useMemo(
    () => catalogFilteredProducts.filter((product) => matchesProductPointFilter(product, pointFilter)),
    [catalogFilteredProducts, pointFilter],
  );

  // 筛选条件或每页条数一变就回到第一页：用 key 比较，避免在 effect 里 setState。
  const filterKey = `${facet?.type ?? ""}:${facet?.value ?? ""}|${pointFilter.category}|${pointFilter.iconId}|${searchTerm}|${pageSize}`;
  const requestedPage = pageSelection.key === filterKey ? pageSelection.index : 0;
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePageIndex = Math.min(requestedPage, pageCount - 1);
  const pagedProducts = React.useMemo(
    () =>
      filteredProducts.slice(
        safePageIndex * pageSize,
        safePageIndex * pageSize + pageSize,
      ),
    [filteredProducts, pageSize, safePageIndex],
  );
  const changePage = React.useCallback(
    (index: number) => setPageSelection({ key: filterKey, index }),
    [filterKey],
  );

  const selectedProducts = React.useMemo(
    () =>
      catalogProducts.filter((product) =>
        selectedProductKeys.has(productKey(product)),
      ),
    [catalogProducts, selectedProductKeys],
  );

  const openProduct = (product: Product) => {
    setSelectedProduct(product);
    setIsDetailOpen(true);
  };

  function replaceProductImage(productId: string, image: string) {
    setDatabaseProducts((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, image } : product,
      ),
    );
    setSelectedProduct((current) =>
      current?.id === productId ? { ...current, image } : current,
    );
  }

  async function duplicateProduct(product: Product) {
    if (!canManageProducts) {
      toast.error("没有产品目录管理权限", {
        description: "复制产品由平台超级管理员执行。",
      });
      return;
    }

    const key = productKey(product);
    setDuplicatingProductKey(key);

    try {
      const response = await fetch("/api/products", {
        body: JSON.stringify(buildDuplicateProductPayload(product)),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { data?: Product; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "PRODUCT_DUPLICATE_FAILED");
      }

      const duplicatedProduct = normalizeProduct(payload.data);
      if (!duplicatedProduct) {
        throw new Error("PRODUCT_DUPLICATE_INVALID");
      }

      setDatabaseProducts((current) => [duplicatedProduct, ...current]);
      setSelectedProduct(duplicatedProduct);
      setIsDetailOpen(true);
      toast.success("产品已复制", {
        description: `${duplicatedProduct.name} 已保留原产品图片。`,
      });
    } catch (error) {
      toast.error("复制产品失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setDuplicatingProductKey("");
    }
  }

  const confirmAddToQuote = () => {
    if (!quoteProduct) {
      return;
    }

    const quantity = addQuoteDraftProduct(
      toQuoteDraftProduct(quoteProduct),
      quoteRoom,
      quoteProject,
    );

    toast.success("已加入报价单", {
      description: `${quoteProject} / ${quoteRoom} / ${quoteProduct.name} x ${quantity}`,
      action: {
        label: "查看报价单",
        onClick: () => {
          window.location.href = "/quotes";
        },
      },
    });
    setQuoteProduct(null);
  };

  const toggleProductSelection = (product: Product, checked: boolean) => {
    const key = productKey(product);

    setSelectedProductKeys((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  };

  const addSelectedToQuote = () => {
    selectedProducts.forEach((product) => {
      addQuoteDraftProduct(
        toQuoteDraftProduct(product),
        quoteRoom,
        quoteProject,
      );
    });
    toast.success("已批量加入报价单", {
      description: `${quoteProject} / ${quoteRoom} / ${selectedProducts.length} 个产品`,
      action: {
        label: "查看报价单",
        onClick: () => {
          window.location.href = "/quotes";
        },
      },
    });
    setSelectedProductKeys(new Set());
  };

  const hasActiveFilters =
    Boolean(facet) || pointFilter.category !== "all" || pointFilter.iconId !== "all";
  const activeFilterCount =
    (facet ? 1 : 0) +
    (pointFilter.category !== "all" ? 1 : 0) +
    (pointFilter.iconId !== "all" ? 1 : 0);
  const clearFilters = () => {
    setFacet(null);
    setPointFilter(ALL_POINT_PRODUCTS);
    setQuery("");
    setSearchTerm("");
  };

  return (
    <section className="flex flex-col gap-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">产品库</h1>
        <p className="text-sm text-muted-foreground">
          选型和报价用的产品数据。核对关键规格与核验状态后加入报价单。
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                const nextValue = event.target.value;
                setQuery(nextValue);

                if (!isComposingRef.current) {
                  setSearchTerm(nextValue);
                }
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                isComposingRef.current = false;
                setQuery(event.currentTarget.value);
                setSearchTerm(event.currentTarget.value);
              }}
              placeholder="搜索名称、SKU、品牌、标签"
              aria-label="搜索产品"
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            aria-expanded={showAllFilters}
            onClick={() => setShowAllFilters((value) => !value)}
          >
            <SlidersHorizontal className="size-4" />
            筛选
            {activeFilterCount > 0 ? (
              <span className="tabular-nums">· {activeFilterCount}</span>
            ) : null}
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" onClick={clearFilters}>
              <X className="size-4" />
              清除筛选
            </Button>
          ) : null}
        </div>

        {showAllFilters ? (
          <div className="flex flex-col gap-4 rounded-xl bg-muted/60 p-4">
            <FacetGroup
              label="平台"
              type="platform"
              values={platforms}
              activeFacet={facet}
              onChange={setFacet}
            />
            <FacetGroup
              label="品牌"
              type="brand"
              values={brands}
              activeFacet={facet}
              onChange={setFacet}
            />
            <FacetGroup
              label="分类"
              type="category"
              values={categories}
              activeFacet={facet}
              onChange={setFacet}
            />
            <ProductPointFilters
              products={catalogFilteredProducts}
              value={pointFilter}
              onChange={setPointFilter}
            />
          </div>
        ) : null}

        {productSource.includes("fallback") && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            当前本地没有读到真实产品库连接，正在显示本地兜底产品。
          </div>
        )}
      </div>

      <Tabs defaultValue="cards" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {!isLoadingProducts && totalProducts > 0 ? (
              <span>
                {filteredProducts.length === totalProducts ? (
                  <>
                    共{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {totalProducts}
                    </span>{" "}
                    个产品
                  </>
                ) : (
                  <>
                    筛出{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {filteredProducts.length}
                    </span>{" "}
                    / 共 {totalProducts} 个产品
                  </>
                )}
              </span>
            ) : null}
            {facet ? (
              <Badge variant="secondary" asChild>
                <button type="button" onClick={() => setFacet(null)}>
                  {facet.label}: {facet.value}
                  <X className="size-3" />
                </button>
              </Badge>
            ) : null}
            {pointFilter.category !== "all" || pointFilter.iconId !== "all" ? (
              <Badge variant="secondary" asChild>
                <button
                  type="button"
                  onClick={() => setPointFilter(ALL_POINT_PRODUCTS)}
                >
                  {pointFilterLabel(pointFilter)}
                  <X className="size-3" />
                </button>
              </Badge>
            ) : null}
          </div>
          <TabsList>
            <TabsTrigger value="cards">
              <Grid2X2 className="size-4" />
              卡片
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="size-4" />
              列表
            </TabsTrigger>
          </TabsList>
        </div>

        <ManagementBar
          actions={[
            {
              icon: FileSpreadsheet,
              label: "加入报价",
              onClick: addSelectedToQuote,
            },
            {
              icon: Tags,
              label: "设置标签",
              onClick: () => {
                toast.info("批量标签已预留", {
                  description: "下一步可以接入真实的产品标签 API。",
                });
              },
              variant: "secondary",
            },
            {
              icon: X,
              label: "清除选择",
              onClick: () => setSelectedProductKeys(new Set()),
              variant: "secondary",
            },
          ]}
          count={selectedProducts.length}
          label="产品"
        />

        <TabsContent value="cards">
          {isLoadingProducts ? (
            <ProductGridSkeleton />
          ) : filteredProducts.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {pagedProducts.map((product) => (
                <ProductCard
                  key={product.id ?? product.sku}
                  product={product}
                  canManage={canManageProducts}
                  duplicating={duplicatingProductKey === productKey(product)}
                  onAddToQuote={() => setQuoteProduct(product)}
                  onDuplicate={() => void duplicateProduct(product)}
                  onOpen={() => openProduct(product)}
                />
              ))}
            </div>
          ) : (
            <ProductsEmptyState />
          )}
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>产品</TableHead>
                    <TableHead>平台 / 分类</TableHead>
                    <TableHead>核验状态</TableHead>
                    <TableHead className="text-right">售价</TableHead>
                    <TableHead className="text-right">库存</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!isLoadingProducts &&
                    pagedProducts.map((product) => (
                      <TableRow
                        key={product.id ?? product.sku}
                        className="cursor-pointer"
                        onClick={() => openProduct(product)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <input
                            aria-label={`选择 ${product.name}`}
                            checked={selectedProductKeys.has(
                              productKey(product),
                            )}
                            className="size-4 accent-foreground"
                            onChange={(event) =>
                              toggleProductSelection(
                                product,
                                event.currentTarget.checked,
                              )
                            }
                            type="checkbox"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ProductImage product={product} className="size-14" />
                            <div className="min-w-0">
                              <div className="font-medium">{product.name}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {product.brand} / {product.sku}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div>{product.platform}</div>
                            <div className="text-xs text-muted-foreground">
                              {product.category}
                            </div>
                            <ProductPointBadge product={product} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <QualityBadge product={product} />
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {productPrice(product)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <StockBadge product={product} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canManageProducts && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={duplicatingProductKey === productKey(product)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void duplicateProduct(product);
                                }}
                              >
                                {duplicatingProductKey === productKey(product) ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Copy className="size-4" />
                                )}
                                复制
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                setQuoteProduct(product);
                              }}
                            >
                              <Plus className="size-4" />
                              加入
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  {isLoadingProducts && <ProductTableSkeleton />}
                  {!isLoadingProducts && filteredProducts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        没有匹配的产品
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <ProductPager
          pageCount={pageCount}
          pageIndex={safePageIndex}
          pageSize={pageSize}
          total={filteredProducts.length}
          onPageChange={changePage}
          onPageSizeChange={setPageSize}
        />
      </Tabs>

      <ProductDetailDialog
        product={selectedProduct}
        products={catalogProducts}
        canManage={canManageProducts}
        open={isDetailOpen}
        onAddToQuote={setQuoteProduct}
        onDuplicate={(product) => void duplicateProduct(product)}
        duplicatingProductKey={duplicatingProductKey}
        onImageUpdated={replaceProductImage}
        onOpenChange={setIsDetailOpen}
      />
      <AddToQuoteDialog
        product={quoteProduct}
        project={quoteProject}
        room={quoteRoom}
        onConfirm={confirmAddToQuote}
        onOpenChange={(open) => {
          if (!open) {
            setQuoteProduct(null);
          }
        }}
        onProjectChange={setQuoteProject}
        onRoomChange={setQuoteRoom}
      />
    </section>
  );
}


function FacetGroup({
  label,
  type,
  values,
  activeFacet,
  onChange,
}: {
  label: string;
  type: Facet["type"];
  values: string[];
  activeFacet: Facet | null;
  onChange: (facet: Facet | null) => void;
}) {
  if (values.length === 0) {
    return null;
  }

  const activeValue = activeFacet?.type === type ? activeFacet.value : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const isActive = activeValue === value;

          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              aria-pressed={isActive}
              onClick={() => onChange(isActive ? null : { label, type, value })}
            >
              {isActive && <Check className="size-3.5" />}
              {value}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function ProductCard({
  canManage,
  duplicating,
  product,
  onAddToQuote,
  onDuplicate,
  onOpen,
}: {
  canManage: boolean;
  duplicating: boolean;
  product: Product;
  onAddToQuote: () => void;
  onDuplicate: () => void;
  onOpen: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      className="overflow-hidden p-0 transition-colors hover:border-primary/50"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <ProductImage
        product={product}
        className="aspect-[4/3] w-full rounded-none border-0"
      />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-sm font-semibold leading-snug">
            {product.name}
          </h2>
          <QualityBadge product={product} />
        </div>
        <div className="space-y-1.5">
          <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            <span>{product.brand}</span>
            <span aria-hidden="true" className="text-muted-foreground/60">
              /
            </span>
            <span className="break-all">{product.sku}</span>
          </p>
          <ProductPointBadge product={product} />
        </div>
        {hasDescription(product) ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {product.description}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold tabular-nums">
            {productPrice(product)}
          </span>
          <StockBadge product={product} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              onAddToQuote();
            }}
          >
            <Plus className="size-4" />
            加入报价
          </Button>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${product.name} 更多操作`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={duplicating} onSelect={onDuplicate}>
                  {duplicating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  复制产品
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function ProductPager({
  pageCount,
  pageIndex,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  total: number;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="tabular-nums text-muted-foreground">
        第 {pageIndex + 1} / {pageCount} 页
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-24" aria-label="每页产品数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top">
            {[24, 48, 96].map((size) => (
              <SelectItem key={size} value={`${size}`}>
                {size} / 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index} className="overflow-hidden p-0">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ProductTableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <TableRow key={index}>
          <TableCell>
            <Skeleton className="size-4" />
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="size-14 rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-28" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-6 w-36" />
          </TableCell>
          <TableCell>
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="ml-auto h-6 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="ml-auto h-4 w-12" />
          </TableCell>
          <TableCell>
            <Skeleton className="ml-auto h-8 w-20" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function ProductsEmptyState() {
  return (
    <Card>
      <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
        <PackageCheck className="size-10 text-muted-foreground" />
        <div>
          <div className="font-medium">没有匹配的产品</div>
          <div className="mt-1 text-sm text-muted-foreground">
            调整搜索词或筛选条件后再试。
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductDetailDialog({
  canManage,
  duplicatingProductKey,
  product,
  products,
  open,
  onAddToQuote,
  onDuplicate,
  onImageUpdated,
  onOpenChange,
}: {
  canManage: boolean;
  duplicatingProductKey: string;
  product: Product | null;
  products: Product[];
  open: boolean;
  onAddToQuote: (product: Product) => void;
  onDuplicate: (product: Product) => void;
  onImageUpdated: (productId: string, image: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);

  if (!product) {
    return null;
  }

  const related = relatedProducts(product, products);
  const relatedRows = related.filter(
    (item) => productKey(item) !== productKey(product),
  );
  const duplicating = duplicatingProductKey === productKey(product);

  async function uploadProductImage(file: File | null) {
    if (!file || !product?.id) {
      return;
    }

    setIsUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "product_image");
      formData.append("entityId", product.id);

      const uploadResponse = await fetch("/api/upload", {
        body: formData,
        method: "POST",
      });
      const uploadPayload = (await uploadResponse.json()) as {
        data?: { url: string };
        error?: string;
      };

      if (!uploadResponse.ok || !uploadPayload.data?.url) {
        throw new Error(uploadPayload.error ?? "UPLOAD_FAILED");
      }

      const saveResponse = await fetch(
        `/api/products/${encodeURIComponent(product.id)}/image`,
        {
          body: JSON.stringify({ image: uploadPayload.data.url }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      const savePayload = (await saveResponse.json()) as { error?: string };

      if (!saveResponse.ok) {
        throw new Error(savePayload.error ?? "PRODUCT_IMAGE_UPDATE_FAILED");
      }

      onImageUpdated(product.id, uploadPayload.data.url);
      toast.success("产品图片已更新");
    } catch (error) {
      toast.error("图片上传失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setIsUploadingImage(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{product.name}</DialogTitle>
          {hasDescription(product) ? (
            <DialogDescription>{product.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={
              product.selectionStatus === "verified" ? "参数已核" : "参数待核"
            }
            tone={product.selectionStatus === "verified" ? "ok" : "warn"}
          />
          <StatusPill
            label={
              product.pricingStatus === "verified" ? "价格已核" : "价格待核"
            }
            tone={product.pricingStatus === "verified" ? "ok" : "danger"}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <ProductImage product={product} className="aspect-square w-full" />
            {canManage && (
              <label
                className={cn(
                  "inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted",
                  (!product.id || isUploadingImage) &&
                    "pointer-events-none opacity-50",
                )}
              >
                {isUploadingImage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UploadCloud className="size-4" />
                )}
                上传产品图片
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={!product.id || isUploadingImage}
                  onChange={(event) => {
                    void uploadProductImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <SpecValue label="售价" value={productPrice(product)} />
              {product.cost != null ? (
                <SpecValue label="成本" value={money(product.cost)} />
              ) : null}
              {product.stock > 0 ? (
                <SpecValue
                  label="库存"
                  value={`${product.stock} ${product.unit}`}
                />
              ) : null}
              {product.price > 0 && product.cost > 0 ? (
                <SpecValue label="毛利" value={productMargin(product)} />
              ) : null}
            </dl>
            <div className={cn("grid gap-2", canManage ? "grid-cols-2" : "grid-cols-1")}>
              {canManage && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={duplicating}
                  onClick={() => onDuplicate(product)}
                >
                  {duplicating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  复制
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAddToQuote(product)}
              >
                <Plus className="size-4" />
                加入
              </Button>
            </div>
            <TagList tags={product.tags} />
          </div>
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">规格</h3>
              <dl className="divide-y divide-border">
                <SpecRow label="平台" value={product.platform} />
                <SpecRow label="品牌" value={product.brand} />
                <SpecRow label="分类" value={product.category} />
                <SpecRow
                  label="设备类型"
                  value={findDeviceType(product.deviceTypeId ?? "")?.name ?? "待整理"}
                />
                <SpecRow
                  label="规格身份"
                  value={
                    product.catalogKind === "sku"
                      ? "具体 SKU"
                      : product.catalogKind === "series"
                        ? "产品系列"
                        : "旧资料待整理"
                  }
                />
              </dl>
            </section>
            {relatedRows.length > 0 ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">同组规格与售价</h3>
                  <p className="text-xs text-muted-foreground">
                    同品牌、同平台、同分类
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg bg-muted/40">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>规格产品</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">售价</TableHead>
                        <TableHead className="text-right">库存</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {relatedRows.map((item) => (
                        <TableRow key={item.id ?? item.sku}>
                          <TableCell className="whitespace-normal font-medium">
                            {item.name}
                          </TableCell>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {productPrice(item)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.stock} {item.unit}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => onAddToQuote(item)}
                            >
                              <Plus className="size-4" />
                              加入
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddToQuoteDialog({
  product,
  project,
  room,
  onConfirm,
  onOpenChange,
  onProjectChange,
  onRoomChange,
}: {
  product: Product | null;
  project: string;
  room: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onProjectChange: (project: string) => void;
  onRoomChange: (room: string) => void;
}) {
  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加入报价单</DialogTitle>
          <DialogDescription>
            {product
              ? `选择 ${product.name} 要加入的项目和房间。`
              : "选择项目和房间。"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="quote-project">项目</Label>
            <Select value={project} onValueChange={onProjectChange} disabled={quoteProjects.length === 0}>
              <SelectTrigger id="quote-project">
                <SelectValue placeholder="暂无项目" />
              </SelectTrigger>
              <SelectContent>
                {quoteProjects.map((projectOption) => (
                  <SelectItem key={projectOption} value={projectOption}>
                    {projectOption}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {quoteProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先创建项目，再加入报价单。</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quote-room">房间</Label>
            <Select value={room} onValueChange={onRoomChange}>
              <SelectTrigger id="quote-room">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quoteRooms.map((roomOption) => (
                  <SelectItem key={roomOption} value={roomOption}>
                    {roomOption}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={quoteProjects.length === 0}>
            <Plus className="size-4" />
            确认加入
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductImage({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const [failedImage, setFailedImage] = React.useState<string | null>(null);
  const imageFailed = failedImage === product.image;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-muted",
        className,
      )}
    >
      {product.image && !imageFailed ? (
        <Image
          src={product.image}
          alt={product.name}
          fill
          unoptimized={needsDirectImageLoad(product.image)}
          sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
          className="object-contain p-4"
          onError={() => setFailedImage(product.image)}
        />
      ) : (
        <div className="flex h-full min-h-14 w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
          <PackageCheck className="size-6" />
          <span>暂无图片</span>
        </div>
      )}
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  const visibleTags = tags.filter((tag) => tag && tag !== "???");

  if (visibleTags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleTags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

/** 详情页的字段值，不带边框，避免对话框里再套一层卡片。 */
function SpecValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** 详情页的字段行，用 1px 分隔线分组；空值不渲染。 */
function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

type StatusTone = "neutral" | "ok" | "warn" | "danger";

const statusToneClass: Record<StatusTone, string> = {
  neutral: "",
  ok: "text-muted-foreground",
  warn: "border-warning/40 bg-warning/10 text-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-destructive-strong",
};

const statusDotClass: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
};

/** 状态标注：色点 + 文字，保证「未核验」这类承诺在卡片上看得见。 */
function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  if (tone === "neutral") {
    return <Badge variant="secondary">{label}</Badge>;
  }

  return (
    <Badge variant="outline" className={statusToneClass[tone]}>
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", statusDotClass[tone])}
      />
      {label}
    </Badge>
  );
}

function QualityBadge({ product }: { product: Product }) {
  if (product.status !== "active" && product.status !== "approved") {
    return <StatusPill label="停用" tone="neutral" />;
  }

  if (product.catalogKind === "series") {
    return <StatusPill label="产品系列" tone="neutral" />;
  }

  if (product.catalogKind !== "sku" || product.selectionStatus !== "verified") {
    return <StatusPill label="待核规格" tone="warn" />;
  }

  if (product.pricingStatus !== "verified") {
    return <StatusPill label="待核价" tone="danger" />;
  }

  if (product.cost == null || product.cost <= 0) {
    return <StatusPill label="待补成本" tone="warn" />;
  }

  return <StatusPill label="可报价" tone="ok" />;
}

function StockBadge({ product }: { product: Product }) {
  if (product.stock <= 0) {
    return <StatusPill label="缺货" tone="danger" />;
  }

  if (product.stock < 10) {
    return <StatusPill label={`低库存 ${product.stock}`} tone="warn" />;
  }

  return <StatusPill label={`库存 ${product.stock}`} tone="ok" />;
}

const EMPTY_PRODUCT_DESCRIPTIONS = new Set(["暂无产品说明", "暂无描述", "无"]);

function hasDescription(product: Product) {
  const description = product.description?.trim() ?? "";

  return (
    description.length > 0 && !EMPTY_PRODUCT_DESCRIPTIONS.has(description)
  );
}

function productPrice(product: Product) {
  return product.price > 0 || product.pricingStatus === "verified"
    ? `${money(product.price)} / ${product.unit}`
    : "待核价";
}

function productMargin(product: Product) {
  if (product.price <= 0 || product.cost <= 0) {
    return "待核";
  }

  return `${Math.round(((product.price - product.cost) / product.price) * 100)}%`;
}

function productKey(product: Product) {
  return product.id ?? product.sku;
}

function buildDuplicateProductPayload(product: Product) {
  const suffix = Date.now().toString(36).toUpperCase();
  const sku = product.sku ? `${product.sku}-COPY-${suffix}` : `COPY-${suffix}`;

  return {
    ...productSelectionWithDefaults(product),
    selectionStatus: "pending",
    pricingStatus: "pending",
    mappingRevision: 1,
    brand: product.brand,
    category: product.category,
    channels: product.channels,
    cost: product.cost,
    description: product.description,
    image: product.image,
    name: `${product.name} 副本`,
    platform: product.platform,
    price: product.price,
    sku,
    stock: product.stock,
    tags: product.tags,
    unit: product.unit,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function normalizeProduct(product: Product): Product | null {
  if (!product?.name || !product.sku) {
    return null;
  }

  return {
    ...product,
    ...productSelectionWithDefaults(product),
    id: product.id ?? product.sku,
    brand: product.brand ?? "General",
    platform: product.platform ?? "General",
    category: product.category ?? "未分类",
    unit: product.unit || "个",
    price: Number(product.price ?? 0),
    cost: Number(product.cost ?? 0),
    stock: Number(product.stock ?? 0),
    image: product.image || "/placeholder.svg",
    description: product.description ?? "暂无产品说明",
    tags: product.tags ?? [],
    channels: product.channels ?? [],
    status: product.status ?? "active",
  };
}

function toQuoteDraftProduct(product: Product) {
  return {
    ...productSelectionWithDefaults(product),
    id: product.id ?? product.sku,
    name: product.name,
    spec: product.sku || product.description || product.category,
    category: product.category,
    unit: product.unit,
    price: product.price,
    cost: product.cost,
    image: product.image,
    visualAsset: product.visualAsset,
  };
}

function isProduct(product: Product | null): product is Product {
  return product !== null;
}

function productSearchText(product: Product) {
  return [
    product.name,
    product.brand,
    product.platform,
    product.category,
    product.sku,
    product.unit,
    product.description,
    ...product.tags,
    ...product.channels,
  ]
    .filter(Boolean)
    .join(" ");
}

function relatedProducts(product: Product, products: Product[]) {
  const exact = products.filter(
    (item) =>
      item.brand === product.brand &&
      item.platform === product.platform &&
      item.category === product.category,
  );

  if (exact.length > 1) {
    return exact;
  }

  return products
    .filter((item) => item.category === product.category)
    .slice(0, 8);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
}
