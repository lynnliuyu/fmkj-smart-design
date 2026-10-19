"use client"

import { useEffect, useId, useState } from "react"
import { ImageIcon, RotateCcw, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { parseProductVisualAssetMutation, productVisualReviewLabels, ProductVisualValidationError, validProductVisualImage, type ProductVisualAsset } from "@/lib/product-visual-assets"

type Props = {
  product: { id: string; name: string } | null
  onClose: () => void
}
type LoadedVisual = { originalImage: string | null; visual: ProductVisualAsset }

/** Its own save action never submits the product price/specification form. */
export function ProductVisualEditor({ product, onClose }: Props) {
  return <Dialog open={Boolean(product)} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>商品展示图库{product ? ` · ${product.name}` : ""}</DialogTitle>
        <DialogDescription>为这个商品保存净图、裁切和主体大小，供各项目重复使用。图片核验状态用于提示资料质量，待核图片仍可正常出图。</DialogDescription>
      </DialogHeader>
      {product ? <ProductVisualEditorBody key={product.id} product={product} /> : null}
    </DialogContent>
  </Dialog>
}

function ProductVisualEditorBody({ product }: { product: NonNullable<Props["product"]> }) {
  const [loaded, setLoaded] = useState<LoadedVisual | null>(null)
  const [draft, setDraft] = useState<ProductVisualAsset | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const fieldId = useId()

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/admin/products/${product.id}/visual`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(apiError(data, "展示图读取失败"))
        if (!controller.signal.aborted) { setLoaded(data); setDraft(data.visual); setError(""); setMessage("") }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "展示图读取失败") })
    return () => controller.abort()
  }, [product.id, reload])

  async function save() {
    if (!draft || busy) return
    setError(""); setMessage("")
    let body
    try { body = parseProductVisualAssetMutation({ image: draft.image, sourceImage: draft.sourceImage, crop: draft.crop, scale: draft.scale, reviewStatus: draft.reviewStatus, evidence: draft.evidence ?? "", expectedRevision: draft.revision }) }
    catch (reason) { setError(reason instanceof ProductVisualValidationError ? Object.values(reason.details).join("；") : "请检查图片资料"); return }
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/products/${product.id}/visual`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(apiError(data, "展示图保存失败"))
      setLoaded(data); setDraft(data.visual)
      setMessage(`展示图已单独保存，版本 ${data.visual.revision}。项目中点击“生成最新版”即可使用。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "展示图保存失败") }
    finally { setBusy(false) }
  }

  function patch(value: Partial<ProductVisualAsset>) { setDraft((current) => current ? { ...current, ...value } : current); setMessage("") }
  const crop = draft?.crop ?? { x: 0, y: 0, width: 1, height: 1 }

  return <div className="space-y-5">
    {draft && loaded ? <>
      <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor={`${fieldId}-image`}>展示图片地址</Label><Input id={`${fieldId}-image`} value={draft.image} onChange={(event) => patch({ image: event.target.value, crop: null })} placeholder="/assets/products/… 或 https://…" /><p className="text-xs text-muted-foreground">建议使用准确型号的产品净图。切换地址后裁切恢复为整张图片。</p></div>
          <div className="space-y-2"><Label htmlFor={`${fieldId}-source`}>原始图片地址</Label><Input id={`${fieldId}-source`} value={draft.sourceImage} onChange={(event) => patch({ sourceImage: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor={`${fieldId}-status`}>图片核验</Label><Select value={draft.reviewStatus} onValueChange={(value) => patch({ reviewStatus: value as ProductVisualAsset["reviewStatus"] })}><SelectTrigger id={`${fieldId}-status`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(productVisualReviewLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-2"><p className="text-sm font-medium">点位圆图预览</p><ProductVisualPreview visual={draft} /><p className="text-xs text-muted-foreground">预览裁切和大小；导出还会自动清理安全的白色留边。</p></div>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">裁切与主体大小</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["x", "左侧"], ["y", "顶部"], ["width", "宽度"], ["height", "高度"]] as const).map(([key, label]) => <div key={key} className="space-y-1.5"><Label htmlFor={`${fieldId}-${key}`}>{label}（%）</Label><Input id={`${fieldId}-${key}`} type="number" min={key === "width" || key === "height" ? 0.1 : 0} max={100} step={0.1} value={Number((crop[key] * 100).toFixed(2))} onChange={(event) => patch({ crop: { ...crop, [key]: event.target.valueAsNumber / 100 } })} /></div>)}</div>
        <div className="flex flex-wrap items-center gap-3"><Label htmlFor={`${fieldId}-scale`}>主体大小 {Number.isFinite(draft.scale) ? draft.scale.toFixed(2) : "—"}×</Label><input id={`${fieldId}-scale`} aria-label="主体大小" type="range" className="h-8 min-w-40 flex-1 accent-primary" min={0.5} max={2} step={0.05} value={draft.scale} onChange={(event) => patch({ scale: event.target.valueAsNumber })} /><Button variant="outline" size="sm" type="button" onClick={() => patch({ crop: null, scale: 1 })}><RotateCcw />恢复自动裁切</Button></div>
      </fieldset>
      <div className="space-y-2"><Label htmlFor={`${fieldId}-evidence`}>图片依据与待核说明</Label><Textarea id={`${fieldId}-evidence`} value={draft.evidence ?? ""} onChange={(event) => patch({ evidence: event.target.value })} maxLength={4000} placeholder="厂家型号页、原图来源、采集日期；系列图请说明适用范围。" /></div>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">查看保留的原图</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><ImageReference label="产品库原图" image={loaded.originalImage} /><ImageReference label="本次展示图原始素材" image={draft.sourceImage} /></div></details>
    </> : !error ? <p role="status" className="py-8 text-center text-muted-foreground">正在载入展示图…</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}>重新载入已保存图片</Button><Button disabled={!draft || busy} onClick={() => void save()}><Save />{busy ? "保存中…" : "单独保存展示图"}</Button></div>
  </div>
}

function ProductVisualPreview({ visual }: { visual: ProductVisualAsset }) {
  const clipId = useId().replaceAll(":", "")
  const [dimensions, setDimensions] = useState({ width: 1, height: 1, image: "" })
  const [failed, setFailed] = useState("")
  const frame = visual.crop ?? { x: 0, y: 0, width: 1, height: 1 }
  const valid = validProductVisualImage(visual.image) && failed !== visual.image && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0
  const ratio = dimensions.image === visual.image ? dimensions.width / dimensions.height : 1
  return <div className="relative flex aspect-square items-center justify-center rounded-lg bg-muted/25">
    {valid ? <>
      {/* This probe preserves the natural aspect ratio in the SVG crop preview. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={visual.image} alt="" className="pointer-events-none absolute size-px opacity-0" onLoad={(event) => { setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight, image: visual.image }); setFailed("") }} onError={() => setFailed(visual.image)} />
      <svg viewBox="0 0 200 200" role="img" aria-label="商品圆图裁切预览" className="w-full max-w-52"><defs><clipPath id={clipId}><circle cx="100" cy="100" r="89" /></clipPath></defs><circle cx="100" cy="100" r="89" fill="#f1f7f5" stroke="rgba(71,131,113,0.32)" strokeWidth="0.8" /><g clipPath={`url(#${clipId})`}><g transform={`translate(100 100) scale(${Number.isFinite(visual.scale) ? visual.scale : 1}) translate(-100 -100)`}><svg x="12" y="12" width="176" height="176" viewBox={`${frame.x * ratio} ${frame.y} ${frame.width * ratio} ${frame.height}`} preserveAspectRatio="xMidYMid meet"><image href={visual.image} width={ratio} height="1" /></svg></g></g></svg>
    </> : <p className="flex flex-col items-center gap-2 px-3 text-center text-xs text-muted-foreground"><ImageIcon className="size-8" />请填写可读取的图片地址</p>}
  </div>
}

function ImageReference({ label, image }: { label: string; image: string | null }) {
  return <div className="space-y-2"><p className="text-xs text-muted-foreground">{label}</p>{image && validProductVisualImage(image) ? <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image} alt={label} className="h-32 w-full rounded-md bg-white object-contain" /><p className="break-all text-xs text-muted-foreground">{image}</p>
  </> : <p className="text-sm text-muted-foreground">暂无原图</p>}</div>
}

function apiError(data: { details?: Record<string, string>; error?: string }, fallback: string) {
  if (data.details) return Object.values(data.details).join("；")
  if (data.error === "UNAUTHORIZED") return "登录已过期，请重新登录后整理图片"
  if (data.error === "PLATFORM_ADMIN_REQUIRED") return "需要超级管理员权限整理商品展示图库"
  return fallback
}
