"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import { useSearchParams } from "next/navigation"
import { Download, FileText, History, Loader2, Printer, RefreshCw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DocumentBrandMark, DocumentContactCard, DocumentPrintFooter } from "@/components/business/document-brand"
import { resolveDocumentBrand, type DocumentBrand } from "@/lib/document-brand"
import { money } from "@/lib/quote-authoring"
import { deliveryLineTotal, deliveryLineUnitPrice, type ProjectDeliverySnapshot, type ProjectDeliverySummary } from "@/lib/project-delivery"
import { prepareProjectDeliveryOutput, loadDeliveryPreview, loadProjectDelivery, loadProjectDeliveryHistory } from "@/lib/project-delivery-client"
import { ProjectViewSwitch } from "@/components/projects/project-view-switch"
import { releasePointMapPrintFloors, renderPointMapPrintFloors, waitForPrintImages, type PointMapPrintFloor } from "@/lib/point-map-print"
import { saveProjectPointMap } from "@/components/projects/point-map-client"
import { PointMapDisplayEditor } from "@/components/projects/point-map-display-editor"
import type { PointMapPlan } from "@/lib/point-map-plan"
import { pointMapMarkerLabel } from "@/lib/point-map-labels"
import { quoteVerificationLabel } from "@/lib/quote-verification"
import { FIRST_PROPOSAL_THEMES, FirstProposalDocument, type FirstProposalTheme } from "@/components/projects/first-proposal-document"
import "./first-proposal-document.css"

type PresentationState = { projectId: string; snapshot: ProjectDeliverySnapshot; floors: PointMapPrintFloor[] }
type ProposalTheme = FirstProposalTheme
type ProposalPrintState = Pick<PresentationState, "snapshot" | "floors"> & { theme: ProposalTheme }
const proposalStyles: Array<{ theme: ProposalTheme; title: string; description: string; image: string; palette: string }> = [
  { theme: "warm", title: FIRST_PROPOSAL_THEMES.warm.name, description: FIRST_PROPOSAL_THEMES.warm.description, image: FIRST_PROPOSAL_THEMES.warm.heroSrc, palette: FIRST_PROPOSAL_THEMES.warm.palette },
  { theme: "atelier", title: FIRST_PROPOSAL_THEMES.atelier.name, description: FIRST_PROPOSAL_THEMES.atelier.description, image: FIRST_PROPOSAL_THEMES.atelier.heroSrc, palette: FIRST_PROPOSAL_THEMES.atelier.palette },
  { theme: "nature", title: FIRST_PROPOSAL_THEMES.nature.name, description: FIRST_PROPOSAL_THEMES.nature.description, image: FIRST_PROPOSAL_THEMES.nature.heroSrc, palette: FIRST_PROPOSAL_THEMES.nature.palette },
  { theme: "gallery", title: FIRST_PROPOSAL_THEMES.gallery.name, description: FIRST_PROPOSAL_THEMES.gallery.description, image: FIRST_PROPOSAL_THEMES.gallery.heroSrc, palette: FIRST_PROPOSAL_THEMES.gallery.palette },
]
function dateLabel(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) }
function safeName(value: string) { return value.replace(/[\\/:*?"<>|]/g, "-") }
function downloadText(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const link = document.createElement("a"); link.href = url; link.download = safeName(name); link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProjectPresentation({ brand, projectId }: { brand?: DocumentBrand; projectId: string }) {
  const documentBrand = brand ?? resolveDocumentBrand()
  const searchParams = useSearchParams()
  const initialDeliveryId = searchParams.get("delivery")
  const rootRef = React.useRef<HTMLElement>(null)
  const proposalDocumentRef = React.useRef<HTMLElement>(null)
  const requestId = React.useRef(0)
  const lifecycle = React.useRef(0)
  const dataRef = React.useRef<PresentationState | null>(null)
  const [data, setData] = React.useState<PresentationState | null>(null)
  const [history, setHistory] = React.useState<ProjectDeliverySummary[]>([])
  const [phase, setPhase] = React.useState<"loading" | "rendering" | "ready">("loading")
  const [error, setError] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const [printing, setPrinting] = React.useState(false)
  const [proposalTheme, setProposalTheme] = React.useState<ProposalTheme>("warm")
  const [proposalPrint, setProposalPrint] = React.useState<ProposalPrintState | null>(null)
  const [editingLayout, setEditingLayout] = React.useState(false)
  const [layoutDirty, setLayoutDirty] = React.useState(false)
  const [selectedPointId, setSelectedPointId] = React.useState<string | null>(null)
  const [selectedSceneId, setSelectedSceneId] = React.useState<string | null>(null)
  const [savingLayout, setSavingLayout] = React.useState(false)
  const busy = phase !== "ready" || printing || savingLayout

  React.useEffect(() => {
    let active = true
    lifecycle.current++
    const ticket = ++requestId.current
    void Promise.resolve().then(async () => {
      if (!active) return
      setPhase("loading"); setError(""); setData(null); dataRef.current = null
      setHistory([]); setEditingLayout(false); setLayoutDirty(false); setSelectedPointId(null); setSelectedSceneId(null); setPrinting(false); setProposalPrint(null); setSavingLayout(false)
      const [snapshot, versions] = await Promise.all([initialDeliveryId ? loadProjectDelivery(projectId, initialDeliveryId) : loadDeliveryPreview(projectId), loadProjectDeliveryHistory(projectId)])
      if (!active) return
      setPhase("rendering"); setHistory(versions)
      const floors = await renderPointMapPrintFloors(snapshot.plan, snapshot.quote?.items ?? [], snapshot.products, { cacheNamespace: `project:${projectId}` })
      if (!active || requestId.current !== ticket) { releasePointMapPrintFloors(floors); return }
      const next = { projectId, snapshot, floors }; dataRef.current = next; setData(next); setPhase("ready")
    }).catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : "资料读取失败，请重试。"); setPhase("ready") } })
    return () => { active = false; requestId.current++; lifecycle.current++ }
  }, [projectId, initialDeliveryId])

  React.useEffect(() => () => { if (data) releasePointMapPrintFloors(data.floors) }, [data])

  async function showSnapshot(loader: () => Promise<ProjectDeliverySnapshot>, editing = false) {
    const epoch = lifecycle.current
    const ticket = ++requestId.current
    setError(""); setNotice(""); setPhase("loading")
    try {
      const snapshot = await loader()
      if (ticket !== requestId.current || epoch !== lifecycle.current) return
      setPhase("rendering")
      const floors = await renderPointMapPrintFloors(snapshot.plan, snapshot.quote?.items ?? [], snapshot.products, { cacheNamespace: `project:${projectId}` })
      if (ticket !== requestId.current || epoch !== lifecycle.current) { releasePointMapPrintFloors(floors); return }
      const next = { projectId, snapshot, floors }; dataRef.current = next; setData(next)
      setLayoutDirty(false); setEditingLayout(editing); setSelectedPointId(null); setSelectedSceneId(null)
      const reused = floors.filter((floor) => floor.reused).length
      setNotice(`${snapshot.version ? `交付 V${snapshot.version}${snapshot.reused ? " 内容一致，已复用" : " 已保存"}` : "当前已保存资料"}；复用 ${reused} 层，更新 ${floors.length - reused} 层。`)
      const versions = await loadProjectDeliveryHistory(projectId)
      if (ticket === requestId.current && epoch === lifecycle.current) { setHistory(versions); return next }
    } catch (reason) { if (ticket === requestId.current && epoch === lifecycle.current) setError(reason instanceof Error ? reason.message : "生成失败，请重试。") }
    finally { if (ticket === requestId.current && epoch === lifecycle.current) setPhase("ready") }
  }

  async function changeLayout(nextPlan: PointMapPlan) {
    const current = dataRef.current
    if (!current || !editingLayout || busy) return
    const ticket = ++requestId.current
    setPhase("rendering"); setError("")
    try {
      const floors = await renderPointMapPrintFloors(nextPlan, current.snapshot.quote?.items ?? [], current.snapshot.products, { cacheNamespace: `project:${projectId}` })
      if (ticket !== requestId.current) { releasePointMapPrintFloors(floors); return }
      const next = { ...current, snapshot: { ...current.snapshot, plan: nextPlan }, floors }
      dataRef.current = next; setData(next); setLayoutDirty(true)
      setNotice("排版预览已更新，保存后可生成新的交付版本。")
    } catch (reason) { if (ticket === requestId.current) setError(reason instanceof Error ? reason.message : "排版无法保存，请调整位置后重试。") }
    finally { if (ticket === requestId.current) setPhase("ready") }
  }

  async function saveLayout() {
    const current = dataRef.current
    if (!current || !layoutDirty || busy) return false
    const epoch = lifecycle.current
    setSavingLayout(true); setError("")
    try {
      await saveProjectPointMap(current.snapshot.plan, current.snapshot.pointMapRevision)
      if (epoch !== lifecycle.current) return false
      const shown = await showSnapshot(() => loadDeliveryPreview(projectId), true)
      if (!shown) return false
      setNotice("展示排版已保存。安装坐标与报价未改动，可以生成最新版。")
      return true
    } catch (reason) { if (epoch === lifecycle.current) setError(reason instanceof Error ? reason.message : "排版保存失败，请重试。"); return false }
    finally { if (epoch === lifecycle.current) setSavingLayout(false) }
  }

  async function generateLatest() {
    if (busy) return
    const epoch = lifecycle.current
    if (layoutDirty && !await saveLayout()) return
    if (epoch !== lifecycle.current) return
    await showSnapshot(() => prepareProjectDeliveryOutput(projectId))
  }

  async function outputDelivery(action: (fixed: PresentationState) => void | Promise<void>) {
    const current = dataRef.current
    if (!current || current.projectId !== projectId || layoutDirty || busy) return
    setPrinting(true); setError("")
    const epoch = lifecycle.current
    try {
      const fixed = current.snapshot.version ? current : await showSnapshot(() => prepareProjectDeliveryOutput(projectId, current.snapshot))
      if (!fixed || epoch !== lifecycle.current) return
      await action(fixed)
    } catch (reason) { if (epoch === lifecycle.current) setError(reason instanceof Error ? reason.message : "交付准备失败，请重试。") }
    finally { if (epoch === lifecycle.current) setPrinting(false) }
  }

  async function printPresentation() {
    if (!rootRef.current || !data || layoutDirty || busy) return
    await outputDelivery(async (printable) => {
      const epoch = lifecycle.current
      const ticket = requestId.current
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!rootRef.current || epoch !== lifecycle.current || ticket !== requestId.current) return
      await waitForPrintImages(rootRef.current)
      if (epoch !== lifecycle.current || ticket !== requestId.current) return
      const previous = document.title
      const printTitle = `${documentBrand.companyName}-${printable.snapshot.project.name}-V${printable.snapshot.version}-智能家居方案`
      document.title = printTitle
      try { window.print() }
      finally { if (document.title === printTitle) document.title = previous }
    })
  }

  async function printFirstProposal() {
    if (!data || layoutDirty || busy) return
    const theme = proposalTheme
    await outputDelivery(async (printable) => {
      const epoch = lifecycle.current
      const ticket = requestId.current
      const previous = document.title
      const printTitle = `${documentBrand.companyName}-${printable.snapshot.project.name}-V${printable.snapshot.version}-${proposalStyles.find((style) => style.theme === theme)!.title}`
      // Keep the exact fixed version and its floor URLs until this print completes.
      // Changing the selected style only affects layout; it never creates another data source.
      flushSync(() => setProposalPrint({ snapshot: printable.snapshot, floors: printable.floors, theme }))
      try {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        if (!proposalDocumentRef.current || epoch !== lifecycle.current || ticket !== requestId.current) return
        await waitForPrintImages(proposalDocumentRef.current)
        if (epoch !== lifecycle.current || ticket !== requestId.current) return
        document.title = printTitle
        window.print()
      } finally {
        if (document.title === printTitle) document.title = previous
        if (epoch === lifecycle.current) flushSync(() => setProposalPrint(null))
      }
    })
  }

  function downloadQuoteCsv() {
    void outputDelivery(({ snapshot }) => {
    if (!snapshot.quote) throw new Error("此交付版本没有报价。")
    const rows: unknown[][] = [["产品", "SKU", "房间", "数量", "单位", "原单价", "折后单价", "折后小计", "核验状态"]]
    for (const item of snapshot.quote.items) rows.push([item.name, item.sku, item.room, item.quantity, item.unit, item.price, deliveryLineUnitPrice(item), deliveryLineTotal(item), quoteVerificationLabel(item)])
    rows.push(["安装调试", "", "", "", "", "", "", snapshot.quote.installationFee, ""], ["应收总额", "", "", "", "", "", "", snapshot.quote.total, ""])
    const csv = "\uFEFF" + rows.map((row) => row.map((value) => {
      const text = String(value ?? "")
      const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
      return `"${safe.replace(/"/g, '""')}"`
    }).join(",")).join("\r\n")
    downloadText(`${snapshot.project.name}-V${snapshot.version}-报价.csv`, csv, "text/csv")
    })
  }

  function downloadFloor(floorId: string) {
    void outputDelivery((fixed) => {
      const image = fixed.floors.find((floor) => floor.id === floorId)
      if (!image) throw new Error("该楼层已变化，请核对生成后的方案再导出。")
      const link = document.createElement("a")
      link.href = image.src
      link.download = safeName(`${fixed.snapshot.project.name}-V${fixed.snapshot.version}-${image.name}.png`)
      link.click()
    })
  }

  const current = data?.projectId === projectId ? data : null
  const snapshot = current?.snapshot
  const unplacedPoints = snapshot?.plan.points.filter((point) => !point.placed) ?? []
  const selectedPoint = snapshot?.plan.points.find((point) => point.id === selectedPointId)
  const selectedScene = snapshot?.plan.scenes?.find((scene) => scene.id === selectedSceneId)
  const highlighted = selectedScene?.pointIds ?? (selectedPointId ? [selectedPointId] : [])
  const relatedItems = snapshot?.quote?.items.filter((item) => (!item.pointMapProjectId || item.pointMapProjectId === projectId) && selectedPointId && item.pointIds?.includes(selectedPointId)) ?? []
  const relatedScenes = snapshot?.plan.scenes?.filter((scene) => selectedPointId && scene.pointIds.includes(selectedPointId)) ?? []
  const versionLabel = snapshot?.version ? `V${snapshot.version}` : "当前预览"
  // 0 值不占位：没有待定位、没有场景时，摘要里就不出现这两句。
  const versionParts = snapshot ? [
    versionLabel,
    snapshot.plan.points.length > 0 ? `共 ${snapshot.plan.points.length} 个点位` : "",
    unplacedPoints.length > 0 ? `${unplacedPoints.length} 个待定位` : "",
    (snapshot.plan.scenes?.length ?? 0) > 0 ? `${snapshot.plan.scenes?.length} 个场景` : "",
  ].filter(Boolean) : []

  return <main ref={rootRef} className="project-presentation mx-auto max-w-[1100px] space-y-6 bg-white p-6 text-slate-900 md:p-10" aria-busy={busy} data-proposal-print={proposalPrint ? "true" : undefined}>
    <div className="project-presentation-toolbar space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectViewSwitch active="presentation" projectId={projectId} hasUnsavedChanges={() => layoutDirty} onSave={saveLayout} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || !snapshot || layoutDirty} onClick={printPresentation}><Printer className="size-4" />打印方案 PDF</Button>
          <Button disabled={busy} onClick={generateLatest}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}生成最新版</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold">客户交付</h1>
          <div className="flex flex-wrap items-center gap-2">
            <History className="size-4 text-slate-500" />
            <label htmlFor="delivery-version" className="sr-only">查看交付版本</label>
            <select id="delivery-version" aria-label="查看交付版本" value={snapshot?.id ?? "preview"} disabled={busy || layoutDirty} className="min-h-9 max-w-full rounded-md border bg-white px-3 text-sm" onChange={(event) => {
              const id = event.target.value
              void showSnapshot(() => id === "preview" ? loadDeliveryPreview(projectId) : loadProjectDelivery(projectId, id))
            }}><option value="preview">当前已保存资料</option>{history.map((version) => <option key={version.id} value={version.id!}>V{version.version} · {dateLabel(version.createdAt)}</option>)}</select>
            <Button size="sm" variant="outline" disabled={busy || layoutDirty} onClick={() => showSnapshot(() => loadDeliveryPreview(projectId), true)}>微调排版</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editingLayout ? <Button size="sm" disabled={!layoutDirty || busy} onClick={saveLayout}><Save className="size-4" />保存排版</Button> : null}
          <Button size="sm" variant="outline" disabled={busy || layoutDirty || !snapshot?.quote} onClick={downloadQuoteCsv}>报价 CSV</Button>
          <Button size="sm" variant="outline" disabled={busy || layoutDirty} onClick={() => void outputDelivery(({ snapshot: fixed }) => downloadText(`${fixed.project.name}-V${fixed.version}-完整方案.json`, JSON.stringify(fixed, null, 2)))}><Download className="size-4" />完整版本 JSON</Button>
        </div>
      </div>
      <p className="text-sm text-slate-600">读取已保存的点位、报价与商品展示图。生成后保留完整版本；图片变化不会自动改价。</p>
      {phase !== "ready" ? <p role="status" className="text-sm text-slate-600">{phase === "rendering" ? "正在更新变化的楼层，未变化部分直接复用…" : "正在核对点位、报价和商品图片…"}</p> : null}
      {notice ? <p role="status" className="text-sm text-slate-600">{notice}</p> : null}
      {error ? <div role="alert" className="space-y-2 text-sm text-destructive-strong"><p>{error}</p>{!snapshot ? <Button variant="outline" size="sm" onClick={() => showSnapshot(() => loadDeliveryPreview(projectId))}>重新读取资料</Button> : null}</div> : null}
      {versionParts.length ? <p className="text-sm font-medium text-slate-600">{versionParts.join(" · ")}</p> : null}
      {snapshot?.changes.messages.length ? <details className="text-sm text-slate-600"><summary className="cursor-pointer py-1">本版变化与来源</summary><ul className="mt-2 list-disc space-y-1 pl-5">{snapshot.changes.messages.map((message, index) => <li key={index}>{message}</li>)}</ul></details> : null}
    </div>

    <section className="project-presentation-toolbar rounded-xl border border-[#e5ddd3] bg-[#faf8f5] p-5 md:p-6" aria-labelledby="first-proposal-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="first-proposal-heading" className="text-xl font-semibold tracking-tight">把配置与预算，讲成家的生活提案</h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">选择一种风格，自动带入本项目的场景、房间配置、报价与点位图。生活图片为氛围示意。</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="首次提案风格">
        {proposalStyles.map((style) => <button key={style.theme} type="button" aria-pressed={proposalTheme === style.theme} disabled={busy} onClick={() => setProposalTheme(style.theme)} className={`overflow-hidden rounded-lg border bg-white text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${proposalTheme === style.theme ? "border-[#8b6e52] ring-1 ring-[#8b6e52]" : "border-[#e5ddd3] hover:border-[#b29b83]"}`}>
          <div className="relative aspect-[2.25/1] overflow-hidden bg-[#e9e4dc]">
            {/* 缩略图仅用于屏幕选风格，不参与原方案 PDF 的图片准备。 */}
            <div role="img" aria-label={`${style.title}的居家氛围示意`} className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${style.image})` }} />
            <span className="absolute bottom-2 left-3 rounded bg-black/45 px-2 py-1 text-xs tracking-wider text-white">{style.palette}</span>
            {proposalTheme === style.theme ? <span className="absolute right-2 top-2 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#6f523b]">已选择</span> : null}
          </div>
          <div className="space-y-1 p-4"><h3 className="font-semibold">{style.title}</h3><p className="text-xs leading-5 text-slate-600">{style.description}</p></div>
        </button>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-slate-600">{layoutDirty ? "请先保存排版，再生成提案。" : snapshot?.version ? `将使用当前查看的 V${snapshot.version}，保留当时的报价与场景。` : "使用已保存资料生成固定版本；请先在报价单页面保存最新报价。"}</p>
        <Button disabled={busy || !snapshot || layoutDirty} onClick={printFirstProposal}>{printing ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}生成提案 PDF</Button>
      </div>
    </section>

    {snapshot ? <>
      <section className="project-presentation-cover rounded-xl border p-8">
        <DocumentBrandMark brand={documentBrand} />
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{snapshot.project.name}</h1>
        <div className="mt-8 grid gap-4 text-sm sm:grid-cols-3">
          <div><span className="text-slate-500">客户</span><strong className="mt-1 block">{snapshot.project.customer || "待补充"}</strong></div>
          <div><span className="text-slate-500">地址</span><strong className="mt-1 block">{snapshot.project.address || "待补充"}</strong></div>
          <div><span className="text-slate-500">方案版本</span><strong className="mt-1 block">{versionLabel} · {dateLabel(snapshot.createdAt)}</strong></div>
        </div>
        <DocumentContactCard brand={documentBrand} />
        <p className="mt-10 text-sm leading-6 text-slate-600">智能家居点位、商品配置与场景设计。{snapshot.version ? `本方案按交付版本 V${snapshot.version} 保存。` : "当前为已保存资料的预览，生成最新版后保留交付记录。"}</p>
      </section>

      <section className="project-presentation-section rounded-xl border p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-semibold"><FileText className="size-5" />方案报价</h2><span className="text-sm text-slate-500">{snapshot.quote?.quoteNo}</span></div>
        {snapshot.quote ? <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4"><Summary label="产品原价" value={money(snapshot.quote.subtotal)} /><Summary label="安装调试" value={money(snapshot.quote.installationFee)} /><Summary label="优惠" value={money(snapshot.quote.discount)} /><Summary label="应收总额" value={money(snapshot.quote.total)} /></div>
          <div className="mt-6 overflow-hidden rounded-lg border"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">产品</th><th className="p-3">房间</th><th className="p-3">数量</th><th className="p-3">折后单价</th><th className="p-3">小计</th></tr></thead><tbody>{snapshot.quote.items.map((item) => <tr key={item.lineId} className="border-t"><td className="p-3"><strong>{item.name}</strong><span className="block text-xs text-slate-500">{item.sku || item.spec || item.category}</span><span className="block text-xs text-slate-500">{quoteVerificationLabel(item)}</span></td><td className="p-3">{item.room || "全屋"}</td><td className="p-3">{item.quantity} {item.unit || "个"}</td><td className="p-3 tabular-nums">{money(deliveryLineUnitPrice(item))}</td><td className="p-3 tabular-nums">{money(deliveryLineTotal(item))}</td></tr>)}</tbody></table></div>
        </> : <p className="mt-4 text-sm leading-6 text-slate-600">当前项目尚未完成商品选型或保存报价。可先核对点位类别和位置，品牌、型号及数量确认后再生成报价。</p>}
      </section>

      <section className="project-presentation-section rounded-xl border p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">场景与控制说明</h2><span className="text-sm text-slate-500">{snapshot.plan.scenes?.length ?? 0} 个场景</span></div>
        {snapshot.plan.scenes?.length ? <div className="mt-5 divide-y">{snapshot.plan.scenes.map((scene) => <article key={scene.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">{scene.name}</h3><Button className="project-presentation-toolbar" size="sm" variant={selectedSceneId === scene.id ? "secondary" : "outline"} onClick={() => { setSelectedSceneId(selectedSceneId === scene.id ? null : scene.id); setSelectedPointId(null) }}>{selectedSceneId === scene.id ? "取消高亮" : `查看 ${scene.pointIds.length} 个关联点位`}</Button></div><p className="mt-2 text-sm text-slate-600">触发：{scene.trigger || "待补充"}</p><p className="mt-1 text-sm text-slate-600">动作：{scene.description || "待补充"}</p><p className="mt-2 text-xs leading-5 text-slate-500">{scene.pointIds.map((id) => { const point = snapshot.plan.points.find((point) => point.id === id); return point ? `${point.room} ${point.code || pointMapMarkerLabel(point)}` : "点位待核对" }).join("、")} · {scene.status === "confirmed" ? "已确认" : "待确认"}</p></article>)}</div> : <p className="mt-4 text-sm leading-6 text-slate-600">尚未保存场景。可在点位工作台配置触发方式、动作和关联设备，再生成新版。</p>}
      </section>

      {unplacedPoints.length ? <section className="project-presentation-section rounded-xl border p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">待定位设备</h2><span className="text-sm text-slate-500">{unplacedPoints.length} 个点位</span></div>
        <p className="mt-3 text-sm leading-6 text-slate-600">以下设备尚未确定安装位置，未绘制在点位图中。</p>
        <ul className="mt-4 divide-y">{unplacedPoints.map((point) => <li key={point.id} className="py-3 text-sm">
          <p className="font-medium">{point.code || "编号待补充"} · {pointMapMarkerLabel(point)} · {point.room || "房间待定"}</p>
          <p className="mt-1 whitespace-pre-line leading-6 text-slate-600">{point.note || "安装位置与配套条件待核对。"}</p>
        </li>)}</ul>
      </section> : null}

      {selectedPoint ? <section className="project-presentation-toolbar border-y py-4 text-sm" aria-label="点位关联资料"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{selectedPoint.code} · {selectedPoint.room} · {pointMapMarkerLabel(selectedPoint)}</h2><Button size="sm" variant="ghost" onClick={() => setSelectedPointId(null)}>收起</Button></div><p className="mt-2 text-slate-600">关联商品：{relatedItems.length ? relatedItems.map((item) => `${item.name}（${money(deliveryLineUnitPrice(item))}/${item.unit}）`).join("；") : snapshot.products.find((product) => product.id === selectedPoint.productId)?.name || "待选型"}</p><p className="mt-1 text-slate-600">关联场景：{relatedScenes.length ? relatedScenes.map((scene) => scene.name).join("、") : "暂未关联"}</p><p className="mt-1 text-slate-600">控制对象：{selectedPoint.controlTargets?.join("、") || "待补充"}</p></section> : null}

      {current!.floors.map((floor) => <section key={floor.id} className="project-presentation-floor rounded-xl border p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{floor.name} · 点位方案</h2><Button variant="outline" size="sm" className="project-presentation-toolbar" disabled={busy || layoutDirty} onClick={() => downloadFloor(floor.id)}><Download className="size-4" />下载 {floor.name} PNG</Button></div><div className="project-presentation-toolbar"><PointMapDisplayEditor plan={snapshot.plan} floor={floor} disabled={!editingLayout || busy} onChange={(plan) => void changeLayout(plan)} selectedPointId={selectedPointId} onPointSelect={(id) => { setSelectedPointId(id); setSelectedSceneId(null) }} highlightPointIds={highlighted} /></div><img src={floor.src} alt={`${floor.name} 商品圆形点位方案`} className="hidden w-full print:block" /></section>)}
      <DocumentPrintFooter />
    </> : null}
    {proposalPrint ? <FirstProposalDocument snapshot={proposalPrint.snapshot} floors={proposalPrint.floors} brand={documentBrand} theme={proposalPrint.theme} documentRef={proposalDocumentRef} /> : null}
  </main>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">{label}</span><strong className="mt-1 block tabular-nums">{value}</strong></div>
}
