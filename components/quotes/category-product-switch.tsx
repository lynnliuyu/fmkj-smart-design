"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findDeviceType } from "@/lib/device-types";
import { ownKeyCount } from "@/lib/category-default-keys";
import { refreshPointMapQuote } from "@/lib/point-map-quote-refresh";
import type { QuoteProductOption } from "@/lib/quote-authoring";

type Choice = { deviceTypeId: string; buttonCount: number; productId: string | null };

const KEYED = new Set(["wall-switch"]);
const KEY_COUNTS = [1, 2, 3, 4];
const categoryName = (id: string) => findDeviceType(id)?.name ?? id;
/** 每个键数的开关是独立类别：值形如 "wall-switch:2"；其他类别为 "type:0"。 */
const encodeCategory = (deviceTypeId: string, buttonCount: number) => `${deviceTypeId}:${buttonCount}`;
const decodeCategory = (value: string) => {
  const index = value.lastIndexOf(":");
  return { deviceTypeId: value.slice(0, index), buttonCount: Number(value.slice(index + 1)) };
};

/**
 * 批量统一换型号：按类别、品牌、键数选择产品，作为同步报价时该范围点位的默认产品。
 * 已保存的报价行不会被直接改写，保存后会自动刷新报价快照。
 */
export function CategoryProductSwitch({
  products,
  projectId,
  projectName,
}: {
  products: QuoteProductOption[];
  projectId: string;
  projectName: string;
}) {
  const byId = React.useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const brandOf = (product: QuoteProductOption) =>
    product.brand ?? (product.parentProductId ? byId.get(product.parentProductId)?.brand ?? null : null);

  const categories = React.useMemo(
    () => Array.from(new Set(products.map((product) => product.deviceTypeId).filter((id): id is string => Boolean(id)))),
    [products],
  );
  const [category, setCategory] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const { deviceTypeId, buttonCount } = category ? decodeCategory(category) : { deviceTypeId: "", buttonCount: 0 };
  const categoryOptions = categories.flatMap((id) =>
    KEYED.has(id) ? KEY_COUNTS.map((count) => encodeCategory(id, count)) : [encodeCategory(id, 0)],
  );
  const [current, setCurrent] = React.useState<Choice[]>([]);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);


  const inCategory = React.useMemo(
    () => products.filter((product) => product.deviceTypeId === deviceTypeId),
    [products, deviceTypeId],
  );
  const brands = React.useMemo(
    () => Array.from(new Set(inCategory.map(brandOf).filter((value): value is string => Boolean(value)))).sort(),
    // brandOf reads from byId which is derived from products; products covers both inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inCategory, byId],
  );
  // 键数为 0 时只列主型号；指定键数时列出该键数的具体产品（子规格或本身带键数的产品）。
  const candidates = inCategory.filter((product) => {
    if (brand && brandOf(product) !== brand) return false;
    if (buttonCount === 0) return !product.parentProductId && ownKeyCount(product) === undefined;
    return ownKeyCount(product) === buttonCount;
  });

  React.useEffect(() => {
    let active = true;
    if (!projectId) return;
    fetch(`/api/category-default-products?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((payload: { data: Choice[] }) => { if (active) setCurrent(payload.data ?? []); })
      .catch(() => { if (active) setCurrent([]); });
    return () => { active = false; };
  }, [projectId]);

  const currentChoice = current.find((choice) => choice.deviceTypeId === deviceTypeId && choice.buttonCount === buttonCount);

  async function save(nextProductId: string | null) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/category-default-products", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, deviceTypeId, buttonCount: buttonCount || undefined, productId: nextProductId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      const refreshed = await fetch(`/api/category-default-products?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }).then((r) => r.json());
      setCurrent(refreshed.data ?? []);
      const refreshedQuote = await refreshPointMapQuote(projectId, projectName);
      setMessage(
        (nextProductId ? "已设为统一型号" : "已恢复标准型号") +
          (refreshedQuote.updated ? "，本机报价预览已更新，请核对后保存数据库报价。" : `。报价预览未更新：${refreshedQuote.message}`),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const currentName = currentChoice?.productId ? byId.get(currentChoice.productId)?.name ?? currentChoice.productId : null;

  return (
    <div className="quote-print-hidden space-y-3 rounded-md bg-muted/30 p-3">
      <div className="text-sm font-medium">本项目统一默认型号</div>
      <p className="text-xs text-muted-foreground">仅影响本项目未指定商品的点位报价，已明确关联的商品与历史交付不变。</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_2fr_auto] xl:items-end">
        <div className="grid gap-2">
          <Label>类别</Label>
          <Select value={category} onValueChange={(value) => { setCategory(value); setBrand(""); setProductId(""); setMessage(""); }}>
            <SelectTrigger aria-label="类别"><SelectValue placeholder="选择类别" /></SelectTrigger>
            <SelectContent>
              {categoryOptions.map((value) => {
                const parsed = decodeCategory(value);
                const label = KEYED.has(parsed.deviceTypeId) ? `${parsed.buttonCount}键开关` : categoryName(parsed.deviceTypeId);
                return <SelectItem key={value} value={value}>{label}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>品牌</Label>
          <Select value={brand || "all"} onValueChange={(value) => { setBrand(value === "all" ? "" : value); setProductId(""); }} disabled={!category}>
            <SelectTrigger aria-label="品牌"><SelectValue placeholder="全部品牌" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部品牌</SelectItem>
              {brands.map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>统一型号</Label>
          <Select value={productId} onValueChange={setProductId} disabled={!category}>
            <SelectTrigger aria-label="统一型号"><SelectValue placeholder="选择型号" /></SelectTrigger>
            <SelectContent>
              {candidates.map((product) => (<SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!projectId || !productId || busy} onClick={() => save(productId)}>应用到本项目</Button>
          <Button type="button" size="sm" variant="outline" disabled={!projectId || !currentChoice?.productId || busy} onClick={() => save(null)}>恢复标准</Button>
        </div>
      </div>
      {currentName && (
        <p className="text-xs text-muted-foreground">当前统一型号：{currentName}</p>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
