"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deviceTypes, findDeviceType, type DeviceSpecs } from "@/lib/device-types";
import { evaluateProductCompatibility, type SelectionProduct } from "@/lib/product-selection";
import type { PointMapNode } from "@/lib/point-map-plan";

const usageNames = { proposed: "待评估", selected: "正式选用", reserve: "预留" } as const;
const valueNames: Record<string, string> = {
  neutral: "零火", "no-neutral": "单火", "dry-contact": "干接点", "low-voltage": "低压",
  "ac-mains": "市电", dc: "直流", battery: "电池", usb: "USB", passive: "无源", poe: "PoE",
  indoor: "室内", outdoor: "室外", "indoor-outdoor": "室内外通用",
  ethernet: "有线网络", wifi: "Wi-Fi", "ethernet-wifi": "有线网络与 Wi-Fi", cellular: "蜂窝网络", analog: "模拟信号",
};

/** Requirements and purchasing intent are separate from the drawing review status. */
export function PointSelectionEditor({ point, products, readOnly = false, historical = false, onPatch }: {
  point: PointMapNode;
  products: SelectionProduct[];
  readOnly?: boolean;
  historical?: boolean;
  onPatch: (patch: Partial<PointMapNode>) => void;
}) {
  const id = React.useId();
  const type = findDeviceType(point.deviceTypeId);
  const candidateProducts: SelectionProduct[] = historical && point.selection ? [{
    ...point.selection, id: point.selection.productId, status: "active", catalogKind: "sku", selectionStatus: "verified", selectionEvidence: "历史选型快照",
  }] : products;
  const candidates = candidateProducts.map((product) => ({ product, result: evaluateProductCompatibility(point, product) }));
  const current = candidates.find(({ product }) => product.id === point.productId);
  const staleSelection = Boolean(current && point.selection && (point.selection.productId !== current.product.id || point.selection.mappingRevision !== current.product.mappingRevision));
  const related = candidates.filter(({ product }) => type && product.deviceTypeId === type.id);
  const compatible = related.filter(({ result }) => result.status === "compatible");
  const incomplete = related.filter(({ result }) => result.status === "incomplete");
  const setRequirement = (key: string, value: DeviceSpecs[string] | undefined) => {
    const requirements = { ...point.requirements };
    if (value === undefined) delete requirements[key];
    else requirements[key] = value;
    onPatch({ requirements });
  };

  return <div className="min-w-0 space-y-3 rounded-md border bg-background p-3" aria-label="点位设备选型">
    <div className="space-y-1"><p className="text-sm font-medium">设备要求与选型</p><p className="text-xs leading-5 text-muted-foreground">布局确认后仍可待选型。按键数、继电器路数和控制灯组分别记录，未知参数留空。带 * 的要求明确后才能核验选型。</p></div>
    <div className="grid gap-2"><Label>设备类型</Label><Select value={point.deviceTypeId || "unknown"} disabled={readOnly} onValueChange={(value) => {
      const next = findDeviceType(value);
      onPatch({ deviceTypeId: next?.id, requirements: undefined, ...(next ? { iconId: next.defaultIconId } : {}) });
    }}><SelectTrigger aria-label="设备类型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">待确定设备类型</SelectItem>{deviceTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
    {type && <div className="grid gap-3 sm:grid-cols-2">{type.specs.map((field) => <div key={field.key} className="grid min-w-0 gap-1.5"><Label htmlFor={`${id}-${field.key}`} className="text-xs">{field.name}{field.requiredForPoint ? " *" : ""}{field.unit ? `（${field.unit}）` : ""}</Label>{field.values || field.type === "boolean" ? <Select value={point.requirements?.[field.key] === undefined ? "unknown" : String(point.requirements[field.key])} disabled={readOnly} onValueChange={(value) => setRequirement(field.key, value === "unknown" ? undefined : field.type === "boolean" ? value === "true" : value)}><SelectTrigger id={`${id}-${field.key}`} aria-label={`要求：${field.name}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">未知 / 暂无要求</SelectItem>{(field.values ?? ["true", "false"]).map((value) => <SelectItem key={value} value={value}>{field.type === "boolean" ? (value === "true" ? "需要" : "不需要") : valueNames[value] || value}</SelectItem>)}</SelectContent></Select> : <Input id={`${id}-${field.key}`} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.integer ? 1 : "any"} disabled={readOnly} placeholder="未知 / 暂无要求" value={String(point.requirements?.[field.key] ?? "")} onChange={(event) => {
      const value = event.target.value;
      if (!value) setRequirement(field.key, undefined);
      else if (field.type !== "number") setRequirement(field.key, value);
      else if (Number.isFinite(Number(value))) setRequirement(field.key, Number(value));
    }} />}</div>)}</div>}
    <div className="grid gap-2"><Label>选用状态</Label><Select value={point.usage ?? "proposed"} disabled={readOnly} onValueChange={(value) => onPatch({ usage: value as PointMapNode["usage"] })}><SelectTrigger aria-label="选用状态"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(usageNames).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">待评估和预留点位保留在图上，不计入采购。</p></div>
    <div className="grid gap-2"><Label>关联具体型号</Label><Select value={point.productId || "none"} disabled={readOnly || !type} onValueChange={(value) => onPatch({ productId: value === "none" ? "" : value, selection: undefined, ...(value !== "none" ? { usage: "selected" as const } : {}) })}><SelectTrigger aria-label="关联产品"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">暂不关联产品</SelectItem>{point.productId && !compatible.some(({ product }) => product.id === point.productId) && <SelectItem value={point.productId}>当前关联：{current?.product.name ?? point.productId}（待处理）</SelectItem>}{compatible.map(({ product }) => <SelectItem key={product.id} value={product.id}>{product.name}{product.manufacturerModel ? ` · ${product.manufacturerModel}` : ""}</SelectItem>)}</SelectContent></Select>
      {!type && <p className="text-xs text-muted-foreground">{historical ? "旧版资料尚无设备类型或选型快照；保留原图，不能视为已核采购规格。" : "先确定设备类型，再筛选具体型号。旧单开占位图标不会自动确定为一键。"}</p>}
      {type && !compatible.length && <p className="text-xs text-muted-foreground">暂无已核实兼容型号，可继续保存和确认布局。</p>}
      {current && current.result.status !== "compatible" && <p role="status" className="text-xs leading-5 text-destructive">当前关联{current.result.status === "incomplete" ? "资料不足" : "不兼容"}：{current.result.reasons.join("；")}。原关联保留，需重新选择。</p>}
      {point.productId && !current && <p role="status" className="text-xs text-destructive">当前产品不可用，请重新选择型号。</p>}
      {current?.result.status === "compatible" && (staleSelection ? <div className="space-y-2"><p role="status" className="text-xs text-destructive">规格已变化，请重新选择型号。原选型快照保留，尚不能用于采购。</p><Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() => onPatch({ productId: point.productId, selection: undefined })}>重新选择当前型号</Button></div> : <p className="text-xs text-muted-foreground">{point.selection ? "已有选型快照；保存和采购前仍会核验最新资料。" : "已选择兼容型号，保存到数据库后由服务器核验。"}</p>)}
      {!!incomplete.length && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{incomplete.length} 个同类型产品待补资料</summary><ul className="mt-2 space-y-2">{incomplete.map(({ product, result }) => <li key={product.id}><span className="font-medium">{product.name}</span><p className="text-muted-foreground">{result.reasons.join("；")}</p></li>)}</ul></details>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">主设备按一个实物计数；轨道长度、配件和安装服务在配套用料中单独确认。</p>
  </div>;
}
