"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyReferenceDrawingBundle, attachReferenceDrawing, drawingViewLabels, type DrawingView, type ReferenceDrawingKind } from "@/lib/point-map-reference-drawings";
import type { PointMapFloor, PointMapPlan, PointMapPosition } from "@/lib/point-map-plan";

type Candidate = { plan: PointMapPlan; floorId: string; kind: ReferenceDrawingKind; name: string; dataUrl: string; width: number; height: number };

export function PointMapDrawings({ plan, floor, view, disabled, onSelect, onApply }: {
  plan: PointMapPlan; floor?: PointMapFloor; view: DrawingView; disabled: boolean;
  onSelect: (view: DrawingView) => void;
  onApply: (next: PointMapPlan, expected: PointMapPlan) => boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const bundleRef = React.useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = React.useState<Candidate | null>(null);
  const [source, setSource] = React.useState<PointMapPosition[]>([]);
  const [target, setTarget] = React.useState<PointMapPosition[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  async function upload(file: File | null) {
    if (!file || disabled || !floor?.floorplanDataUrl || view === "layout") return;
    const baseline = plan, floorId = floor.id, kind = view;
    setError(""); setBusy(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20MB 的 PNG、JPG 或 WebP 对照图。");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file);
      });
      const image = new Image(); image.src = dataUrl; await image.decode();
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 36_000_000) throw new Error("图片尺寸无效或超过 3600 万像素。");
      setCandidate({ plan: baseline, floorId, kind, name: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
      setSource([]); setTarget([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "对照图读取失败。"); }
    finally { setBusy(false); }
  }
  function pick(side: "source" | "target", event: React.MouseEvent<HTMLImageElement>) {
    if (source.length >= 3 && target.length >= 3) return;
    if (side === "source" ? source.length !== target.length : source.length !== target.length + 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = { x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)) };
    (side === "source" ? setSource : setTarget)((points) => [...points, position]);
  }
  async function apply() {
    if (!candidate || source.length !== 3 || target.length !== 3 || disabled) return;
    setBusy(true); setError("");
    try {
      const next = await attachReferenceDrawing(candidate.plan, candidate.floorId, candidate.kind, candidate, source.map((position, index) => ({ source: position, target: target[index] })));
      if (!onApply(next, candidate.plan)) throw new Error("配准期间方案已变化，请在当前图纸上重新配准。");
      onSelect(candidate.kind); setCandidate(null); setMessage("对照图已加入当前草稿，切换时沿用相同位置与缩放；请保存草稿写入数据库。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "配准失败。"); }
    finally { setBusy(false); }
  }
  async function importBundle(file: File | null) {
    if (!file || disabled || busy) return;
    const baseline = plan; setBusy(true); setError("");
    try {
      if (file.size > 28 * 1024 * 1024) throw new Error("图纸包超过 28MB，请按楼层拆分导入。");
      const next = await applyReferenceDrawingBundle(baseline, JSON.parse(await file.text()));
      if (!onApply(next, baseline)) throw new Error("导入期间方案已变化，请重新导入。");
      setMessage("已导入已配准的灯光 / 开关图，请保存草稿。布局净底和安装点保持原样。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图纸包导入失败。"); }
    finally { setBusy(false); }
  }
  const candidateFloor = candidate?.plan.floors?.find((item) => item.id === candidate.floorId);
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium">图纸对照</span>
      {(["layout", "lighting", "switch"] as const).map((kind) => <Button key={kind} size="sm" variant={view === kind ? "secondary" : "outline"} aria-pressed={view === kind} onClick={() => { setError(""); onSelect(kind); }}>
        {drawingViewLabels[kind]}{kind !== "layout" && !floor?.references?.[kind] ? " · 未导入" : ""}
      </Button>)}
      {view !== "layout" ? <Button size="sm" variant="outline" disabled={disabled || busy || !floor?.floorplanDataUrl} onClick={() => fileRef.current?.click()}>{floor?.references?.[view] ? "更换并重新配准" : "添加并配准"}</Button> : null}
      <Button size="sm" variant="ghost" disabled={disabled || busy || !floor?.floorplanDataUrl} onClick={() => bundleRef.current?.click()}>导入已配准图纸包</Button>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">布局净底是布点基准。灯光 / 开关图配准后可在同一位置切换对照，点位和缩放保持；对照图不替换客户交付底图。</p>
    <input ref={fileRef} type="file" className="hidden" aria-label="添加灯光或开关对照图" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={(event) => { void upload(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
    <input ref={bundleRef} type="file" className="hidden" aria-label="导入已配准图纸包" accept="application/json,.json" disabled={disabled || busy} onChange={(event) => { void importBundle(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
    {message ? <p role="status" className="text-xs">{message}</p> : null}
    {error && !candidate ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Dialog open={Boolean(candidate)} onOpenChange={(open) => { if (!open && !busy) setCandidate(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>配准{candidate ? drawingViewLabels[candidate.kind] : "对照图"}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">依次在左、右两图点击同一个建筑角点，共三组。请选择分散在建筑四周的角点，横纵跨度各至少一半，不要沿同一条直线选点。</p>
        <p role="status" className="text-sm font-medium">{target.length === 3 ? "已选三组角点，可完成配准" : `第 ${target.length + 1} 组：请点击${source.length === target.length ? "左侧布局图" : "右侧对照图"}的相同位置`}</p>
        <div className="grid items-start gap-4 md:grid-cols-2">
          {candidate && candidateFloor ? (["source", "target"] as const).map((side) => <figure key={side} className="min-w-0 space-y-2">
            <figcaption className="text-sm">{side === "source" ? "布局净底" : candidate.name}</figcaption>
            <div className="relative overflow-hidden border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- Click coordinates use this exact image rectangle. */}
              <img src={side === "source" ? candidateFloor.floorplanDataUrl : candidate.dataUrl} alt={side === "source" ? "配准布局图" : "配准对照图"} className="block h-auto w-full cursor-crosshair" draggable={false} onClick={(event) => pick(side, event)} />
              {(side === "source" ? source : target).map((point, index) => <span key={index} className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-orange-600 text-xs text-white" style={{ left: `${point.x}%`, top: `${point.y}%` }}>{index + 1}</span>)}
            </div>
          </figure>) : null}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { setSource([]); setTarget([]); setError(""); }}>重新选点</Button><Button disabled={disabled || busy || source.length !== 3 || target.length !== 3} onClick={apply}>完成配准并加入</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
