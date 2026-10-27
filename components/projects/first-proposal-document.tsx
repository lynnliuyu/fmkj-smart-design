import * as React from "react"

import type { DocumentBrand } from "@/lib/document-brand"
import type { PointMapNode, PointMapScene } from "@/lib/point-map-plan"
import type { PointMapPrintFloor } from "@/lib/point-map-print"
import { deliveryLineTotal, deliveryLineUnitPrice, type ProjectDeliveryQuoteItem, type ProjectDeliverySnapshot } from "@/lib/project-delivery"
import { money } from "@/lib/quote-authoring"
import { quoteVerification, quoteVerificationLabel } from "@/lib/quote-verification"

export const FIRST_PROPOSAL_THEMES = {
  warm: {
    name: "暖境 · 生活提案", description: "奶油纸色与生活杂志排版，先讲日常体验，再展开配置与预算。", palette: "米白 / 暖棕",
    heroSrc: "/assets/proposals/warm-living.jpg", sceneSrc: "/assets/proposals/warm-living.jpg", heroAlt: "温暖住宅客厅意向",
    coverLines: ["让家，", "懂你的日常。"], sceneTitle: "把平常的一天，过得更顺。", sceneQuote: ["好的智能体验，", "应该藏在生活的", "自然发生里。"],
  },
  atelier: {
    name: "序境 · 空间提案", description: "炭黑封面与铜金细节，以建筑作品集的节奏讲清空间与配置。", palette: "炭黑 / 铜色",
    heroSrc: "/assets/proposals/atelier-living.jpg", sceneSrc: "/assets/proposals/atelier-living.jpg", heroAlt: "暮色现代住宅意向",
    coverLines: ["把生活，", "调到舒适。"], sceneTitle: "空间随生活，恰好回应。", sceneQuote: ["好的智能体验，", "应该藏在生活的", "自然发生里。"],
  },
  nature: {
    name: "自然疗愈 · 日光提案", description: "原木、石材与植物的自然叙事，把光线、空气与舒适写进每个空间。", palette: "原木 / 鼠尾草",
    heroSrc: "/assets/proposals/natural-living.jpg", sceneSrc: "/assets/proposals/nature-bedroom.jpg", heroAlt: "自然疗愈住宅意向",
    coverLines: ["把日光，", "留在生活里。"], sceneTitle: "让自然的节奏，回到室内。", sceneQuote: ["光线、空气与灯光，", "一起工作，", "却不打扰生活。"],
  },
  gallery: {
    name: "光影艺廊 · 空间提案", description: "以画廊般的秩序呈现材质、光影与隐藏式控制，适合强调设计感的客户。", palette: "墨蓝 / 琥珀",
    heroSrc: "/assets/proposals/gallery-living.jpg", sceneSrc: "/assets/proposals/future-living.jpg", heroAlt: "光影艺廊住宅意向",
    coverLines: ["让空间，", "回应生活。"], sceneTitle: "把控制藏进空间秩序。", sceneQuote: ["当技术退到幕后，", "设计才真正开始。", "每一次回应都恰到好处。"],
  },
} as const

export type FirstProposalTheme = keyof typeof FIRST_PROPOSAL_THEMES

export type FirstProposalDocumentProps = {
  snapshot: ProjectDeliverySnapshot
  floors: PointMapPrintFloor[]
  brand: DocumentBrand
  theme: FirstProposalTheme
  documentRef?: React.Ref<HTMLElement>
  demo?: boolean
}

type Room = { name: string; points: PointMapNode[]; items: ProjectDeliveryQuoteItem[]; amount: number }
const QUOTE_SCOPE_NOTE = "报价含基础安装调试，不含强电改造和额外布线费用。最终金额以现场复核和客户确认版本为准。"

function versionLabel(snapshot: ProjectDeliverySnapshot) {
  return snapshot.version > 0 ? `固定交付 V${snapshot.version}` : "已保存资料预览 · 非固定版本"
}

function pointName(point: PointMapNode) {
  const state = point.usage === "reserve" ? "（预留）" : point.usage === "proposed" ? "（待评估）" : ""
  return `${point.room || "房间待定"} ${point.code || point.name}${state}`
}

function date(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value || "日期待补充" : parsed.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
}

/** Pagination estimates only document space; quantities and money stay in the saved delivery. */
function pages<T>(items: T[], capacity: number, weight: (item: T) => number = () => 1): T[][] {
  const result: T[][] = []
  let current: T[] = [], used = 0
  for (const item of items) {
    const size = weight(item)
    if (current.length && used + size > capacity) { result.push(current); current = []; used = 0 }
    current.push(item); used += size
  }
  if (current.length) result.push(current)
  return result
}

function projectRooms(snapshot: ProjectDeliverySnapshot): Room[] {
  const rooms = new Map<string, Room>()
  const floors = new Map((snapshot.plan.floors ?? []).map((floor) => [floor.id, floor.name]))
  const quotedRoomNames = [...new Set((snapshot.quote?.items ?? []).map((item) => item.room.trim()))]
  const canonical = (value: string) => value.replace(/\s*\/\s*/g, "/").trim()
  const pointRoomFloors = new Map<string, Set<string>>()
  for (const point of snapshot.plan.points) {
    const room = point.room.trim()
    if (!pointRoomFloors.has(room)) pointRoomFloors.set(room, new Set())
    pointRoomFloors.get(room)!.add(point.floorId ?? "")
  }
  const get = (name: string) => {
    const roomName = name.trim() || "全屋 / 未分房间"
    if (!rooms.has(roomName)) rooms.set(roomName, { name: roomName, points: [], items: [], amount: 0 })
    return rooms.get(roomName)!
  }
  for (const point of snapshot.plan.points) {
    const floorName = floors.get(point.floorId ?? "")
    const composite = floorName ? `${floorName} / ${point.room.trim()}` : point.room
    const quotedComposite = quotedRoomNames.find((room) => canonical(room) === canonical(composite))
    const multipleFloors = (pointRoomFloors.get(point.room.trim())?.size ?? 0) > 1
    get(quotedComposite || (multipleFloors && floorName ? composite : point.room)).points.push(point)
  }
  for (const item of snapshot.quote?.items ?? []) {
    const room = get(item.room)
    room.items.push(item)
    room.amount += deliveryLineTotal(item)
  }
  return [...rooms.values()]
}

function verificationReasons(item: ProjectDeliveryQuoteItem) {
  return quoteVerification(item).reasons.join("；")
}

function Brand({ brand, closing = false }: { brand: DocumentBrand; closing?: boolean }) {
  return <div className={`fp-brand${closing ? " fp-brand-closing" : ""}`}>
    {brand.logoSrc ? <img src={brand.logoSrc} alt="" className="fp-brand-logo" /> : null}
    <div><strong>{brand.companyName}</strong>{closing && brand.contact ? <p>{brand.contact}</p> : null}{closing && brand.address ? <p>{brand.address}</p> : null}</div>
  </div>
}

function Footer({ snapshot, brand, demo, label }: { snapshot: ProjectDeliverySnapshot; brand: DocumentBrand; demo: boolean; label: string }) {
  return <footer className="fp-footer"><span>{demo ? "示例演示 · 非客户正式报价" : brand.companyName}</span><span>{label} · {snapshot.version > 0 ? `V${snapshot.version}` : "版本待生成"}</span></footer>
}

function Page({ children, snapshot, brand, demo, label, className = "" }: {
  children: React.ReactNode; snapshot: ProjectDeliverySnapshot; brand: DocumentBrand; demo: boolean; label: string; className?: string
}) {
  return <section className={`fp-page ${className}`} aria-label={label}>
    <div className="fp-running"><span>{brand.companyName}</span><span>{snapshot.project.name}</span></div>
    <div className="fp-page-body">{children}</div>
    <Footer snapshot={snapshot} brand={brand} demo={demo} label={label} />
  </section>
}

function Heading({ title, description, aside }: { title: string; description?: string; aside?: string }) {
  return <header className="fp-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{aside ? <span>{aside}</span> : null}</header>
}

function Cover({ snapshot, brand, theme, demo }: Omit<FirstProposalDocumentProps, "floors" | "documentRef">) {
  const meta = FIRST_PROPOSAL_THEMES[theme]
  const sidebar = theme === "atelier" || theme === "gallery"
  return <section className={`fp-page fp-cover fp-cover-${theme}`} aria-label="提案封面">
    <div className="fp-cover-brand"><Brand brand={brand} /><span>{demo ? "示例演示" : "首次提案"}</span></div>
    <div className="fp-cover-title"><h1>{meta.coverLines[0]}<br />{meta.coverLines[1]}</h1><p>全屋智能 · 生活体验与空间设计</p></div>
    <div className="fp-cover-composition">
      {sidebar ? <div className="fp-cover-sidebar"><span>{theme === "gallery" ? <>材质有序<br />光影从容</> : <>空间有序<br />生活从容</>}</span><p>{theme === "gallery" ? <>让技术退后，<br />让空间先被感受。</> : <>从一次回家，<br />到每个安心的夜晚。</>}</p><div><strong>{snapshot.project.name}</strong><p>{snapshot.project.customer || "客户信息待补充"}</p></div></div> : null}
      <figure className="fp-cover-image"><img src={meta.heroSrc} alt={meta.heroAlt} /><figcaption>AI 意向示意 · 非项目实景</figcaption></figure>
    </div>
    <div className="fp-cover-project"><div><h2>{snapshot.project.name}</h2><p>{snapshot.project.address || "项目地址待补充"}</p></div><div>{snapshot.project.code ? <span>项目编号 {snapshot.project.code}</span> : null}<span>{snapshot.version > 0 ? `固定交付版本 V${snapshot.version}` : "待生成固定交付版本"}</span><span>{date(snapshot.createdAt)}</span></div></div>
    {!sidebar ? <p className="fp-cover-customer">为 {snapshot.project.customer || "您"} 呈上 · 生活提案 / 场景设计 / 配置与预算</p> : null}
    <Footer snapshot={snapshot} brand={brand} demo={Boolean(demo)} label={meta.name} />
  </section>
}

function Overview({ snapshot, rooms, ...common }: { snapshot: ProjectDeliverySnapshot; rooms: Room[]; brand: DocumentBrand; demo: boolean }) {
  const chunks = pages(rooms, 6, (room) => 1 + Math.ceil((room.name.length + [...new Set(room.items.map((item) => item.name))].join("、").length) / 90))
  const sceneCount = snapshot.plan.scenes?.length ?? 0
  return (chunks.length ? chunks : [[]]).map((chunk, index) => <Page key={index} snapshot={snapshot} {...common} label={`项目概览${index ? ` · 续 ${index}` : ""}`}>
    <Heading title={index ? "空间配置，逐一展开。" : "从家的日常开始。"} description="让设备的选择回到生活本身：在哪个空间使用、怎样触发、希望发生什么。" />
    {!index ? <>
      <div className="fp-introduction"><p>这份提案把 <strong>{snapshot.project.name}</strong> 的空间、场景与产品配置放在一起，帮助您判断：哪些体验值得保留，哪些细节还需要调整。</p><p>先看生活方式，再核对设备与预算。每一个未确认的地方都保留说明，方便我们一起把方案做得更贴近您的习惯。</p></div>
      <div className="fp-facts"><div><span>客户</span><strong>{snapshot.project.customer || "待补充"}</strong></div><div><span>设计范围</span><strong>{rooms.length} 个配置区域</strong></div><div><span>点位 / 场景</span><strong>{snapshot.plan.points.length} 处 / {sceneCount} 项</strong></div><div><span>方案依据</span><strong>{snapshot.version > 0 ? `固定交付 V${snapshot.version}` : "已保存资料预览"}</strong></div></div>
    </> : null}
    <div className="fp-room-index"><h3>您家的空间配置</h3>{chunk.length ? chunk.map((room) => <div className="fp-room-row" key={room.name}><div><strong>{room.name}</strong><span>{room.points.length} 处设计点位 · {room.items.length} 行选配{room.points.some((point) => point.usage === "reserve" || point.usage === "proposed") ? "（含预留 / 待评估点位）" : ""}</span></div><p>{[...new Set(room.items.map((item) => item.name))].join("、") || (room.points.length ? [...new Set(room.points.map((point) => `${point.name}${point.usage === "reserve" ? "（预留）" : point.usage === "proposed" ? "（待评估）" : ""}`))].join("、") : "具体设备待选")}</p></div>) : <p className="fp-empty">本版尚未保存房间配置。空间范围与设备选择需要沟通后补充。</p>}</div>
    {!index ? <div className="fp-reading-path"><h3>一起看方案的顺序</h3><ol><li><strong>聊生活</strong><span>确认您希望改变的日常体验</span></li><li><strong>看空间</strong><span>核对设备位置与使用习惯</span></li><li><strong>选配置</strong><span>确认外观、型号与配套范围</span></li><li><strong>定预算</strong><span>逐项确认，再形成后续版本</span></li></ol></div> : null}
  </Page>)
}

function SceneStory({ scene, snapshot, index }: { scene: PointMapScene; snapshot: ProjectDeliverySnapshot; index: number }) {
  const related = scene.pointIds.map((id) => snapshot.plan.points.find((point) => point.id === id))
  const rooms = [...new Set(related.filter((point): point is PointMapNode => Boolean(point)).map((point) => point.room || "房间待定"))]
  return <article className="fp-scene">
    <div className="fp-scene-title"><span className="fp-scene-index">{String(index + 1).padStart(2, "0")}</span><h3>{scene.name || "未命名场景"}</h3><span className={`fp-status ${scene.status === "confirmed" ? "fp-status-confirmed" : ""}`}>{scene.status === "confirmed" ? "设计已确认" : "待确认"}</span></div>
    <div className="fp-scene-story"><div><span>当您这样做</span><p>{scene.trigger || "触发方式待沟通"}</p></div><div><span>家会这样回应</span><p>{scene.description || "具体动作待沟通"}</p></div></div>
    <p className="fp-scene-links">{rooms.length ? `涉及空间：${rooms.join("、")}。` : "涉及空间待核对。"}{scene.pointIds.length ? `关联 ${scene.pointIds.length} 处点位：${related.map((point) => point ? pointName(point) : "点位待核对").join("、")}` : "本场景尚未关联设备点位。"}</p>
  </article>
}

function Scenes({ snapshot, theme, ...common }: { snapshot: ProjectDeliverySnapshot; theme: FirstProposalTheme; brand: DocumentBrand; demo: boolean }) {
  const scenes = snapshot.plan.scenes ?? []
  const meta = FIRST_PROPOSAL_THEMES[theme]
  const chunks = pages(scenes, theme === "warm" ? 3 : 2, (scene) => Math.max(1, (scene.name.length + scene.trigger.length + scene.description.length + scene.pointIds.length * 9) / 240))
  let sceneIndex = 0
  return (chunks.length ? chunks : [[]]).map((chunk, index) => <Page key={index} snapshot={snapshot} {...common} label={`生活场景${index ? ` · 续 ${index}` : ""}`} className="fp-scenes-page">
    <Heading title={meta.sceneTitle} description="以下仅展示本版本已保存的场景。场景设计确认与现场安装、调试完成是不同阶段。" aside={`${scenes.length} 项已保存场景`} />
    {!index ? <div className="fp-scene-mood"><figure><img src={meta.sceneSrc} alt={`${meta.name}场景氛围意向`} /><figcaption>AI 意向示意 · 非项目实景</figcaption></figure><p>{meta.sceneQuote.map((line, lineIndex) => <React.Fragment key={line}>{line}{lineIndex < meta.sceneQuote.length - 1 ? <br /> : null}</React.Fragment>)}</p></div> : null}
    <div className="fp-scene-list">{chunk.length ? chunk.map((scene) => <SceneStory key={scene.id} scene={scene} snapshot={snapshot} index={sceneIndex++} />) : <div className="fp-empty"><h3>先聊习惯，再定义场景。</h3><p>本版本尚未保存场景，暂不将生活设想写成已包含功能。建议从回家、休息与离家等时刻聊起，确认触发方式、动作和关联设备后，再补入下一版提案。</p></div>}</div>
    <p className="fp-scope-note">“待确认”表示仍需与您沟通；“设计已确认”表示场景设计已确认，不代表设备已经安装或功能已经验收。</p>
  </Page>)
}

function Products({ snapshot, theme, ...common }: { snapshot: ProjectDeliverySnapshot; theme: FirstProposalTheme; brand: DocumentBrand; demo: boolean }) {
  const items = snapshot.quote?.items ?? []
  const title = theme === "nature" ? "触手可及的自然舒适。" : theme === "gallery" ? "把控制藏进空间秩序。" : theme === "warm" ? "看得见的质感，用得上的配置。" : "看得见的质感，用得上的配置。"
  const chunks = pages(items, theme === "warm" ? 4 : 3, (item) => 1 + Math.max(0, (item.spec.length + item.name.length + verificationReasons(item).length - 160) / 140))
  return (chunks.length ? chunks : [[]]).map((chunk, index) => <Page key={index} snapshot={snapshot} {...common} label={`产品选配${index ? ` · 续 ${index}` : ""}`} className="fp-products-page">
    <Heading title={index ? "延续相同的选择标准。" : title} description="选配来自本版本的真实报价。图片用于识别外观，具体供货规格与核验状态请一并确认。" aside={`${items.length} 行选配`} />
    <div className="fp-product-list">{chunk.length ? chunk.map((item) => {
      const product = snapshot.products.find((product) => product.id === item.id)
      const src = product?.image || item.image
      return <article className="fp-product" key={item.lineId}>
        <div className="fp-product-photo">{src ? <img src={src} alt={item.name} /> : <span>产品图片待补充</span>}</div>
        <div className="fp-product-copy"><span className="fp-product-room">{item.room || "全屋 / 未分房间"}</span><h3>{item.name}</h3><p className="fp-product-brand">{[item.brand, item.sku].filter(Boolean).join(" · ") || "品牌 / 型号待补充"}</p>{item.spec ? <p className="fp-product-spec">{item.spec}</p> : null}<div className="fp-product-bottom"><strong>{item.quantity} {item.unit || "个"}</strong><span>{quoteVerificationLabel(item)}</span></div>{verificationReasons(item) ? <p className="fp-product-reason">{verificationReasons(item)}</p> : null}</div>
      </article>
    }) : <p className="fp-empty">本版尚未保存产品报价，产品图片、型号与数量将在明确选配后展示。</p>}</div>
    <p className="fp-scope-note">未核验行可用于本次沟通报价；具体型号、参数、价格及配套范围仍需核对。产品图不代替准确规格与现场适配确认。</p>
  </Page>)
}

function Budget({ snapshot, rooms, ...common }: { snapshot: ProjectDeliverySnapshot; rooms: Room[]; brand: DocumentBrand; demo: boolean }) {
  const quote = snapshot.quote
  const quotedRooms = rooms.filter((room) => room.items.length)
  // Keep the introductory budget page within one physical A4 sheet once the
  // total, fees and reading notes are included. A smaller room batch gives
  // unusually long room names and future customer data room to breathe.
  const chunks = pages(quotedRooms, 6, (room) => 1 + room.name.length / 35)
  return (chunks.length ? chunks : [[]]).map((chunk, index) => <Page key={index} snapshot={snapshot} {...common} label={`预算总览${index ? ` · 续 ${index}` : ""}`} className="fp-budget-page">
    <Heading title={index ? "每个空间，都有清楚的投入。" : "把预算，花在在意的生活里。"} description="按房间理解设备投入，再逐行核对完整报价。金额使用本版本已保存的报价。" />
    {quote ? <>
      {!index ? <div className="fp-budget-total"><div><span>本版应收总额</span><strong>{money(quote.total)}</strong><p>{quote.quoteNo} · {quote.title}</p></div><p>含本版已报价产品与安装调试费用；<br />未计入的配套范围，请见逐行说明。</p></div> : null}
      <h3 className="fp-table-title">分空间产品预算</h3><table className="fp-budget-table"><thead><tr><th>空间</th><th>报价行数</th><th>产品折后小计</th></tr></thead><tbody>{chunk.map((room) => <tr key={room.name}><td>{room.name}</td><td>{room.items.length} 行</td><td>{money(room.amount)}</td></tr>)}</tbody></table>
      {!index ? <div className="fp-fees"><div><span>产品原价合计</span><strong>{money(quote.subtotal)}</strong></div><div><span>已保存优惠金额</span><strong>{money(quote.discount)}</strong></div><div><span>安装调试费用</span><strong>{money(quote.installationFee)}</strong></div><div className="fp-fees-final"><span>应收总额</span><strong>{money(quote.total)}</strong></div></div> : null}
      <div className="fp-budget-notes"><h3>预算怎么读</h3><p>分空间小计仅汇总对应产品的折后金额。安装调试费用单列，不重复摊入房间；最终应收以本版总额为准。</p><p>逐行报价会列出原单价、折后单价、数量、单位及小计。未核验、默认型号与配套未计入等说明均保留，请一并核对。</p><p>{QUOTE_SCOPE_NOTE}</p></div>
    </> : <p className="fp-empty">本版尚未保存报价，暂不展示金额。选配与价格明确后，再形成可确认的预算。</p>}
  </Page>)
}

function QuoteDetails({ snapshot, ...common }: { snapshot: ProjectDeliverySnapshot; brand: DocumentBrand; demo: boolean }) {
  const quote = snapshot.quote
  // Quote rows carry verification and omitted-scope notes, so use a modest
  // page budget. This prevents a long row from pushing the footer onto a
  // separate physical page during browser printing.
  const chunks = pages(quote?.items ?? [], 4.5, (item) => 1 + (item.name.length + item.spec.length + item.room.length + verificationReasons(item).length) / 105)
  return (chunks.length ? chunks : [[]]).map((chunk, index) => <Page key={index} snapshot={snapshot} {...common} label={`完整报价${index ? ` · 续 ${index}` : ""}`} className="fp-quote-page">
    <Heading title="每一项选择，都清楚列明。" description="产品、规格、范围与金额共同构成本次报价。未核验原因与配套遗漏不因排版而省略。" aside={quote?.quoteNo} />
    {quote ? <>
      <div className="fp-quote-context"><span>{quote.title || "项目方案报价"}</span><span>{versionLabel(snapshot)} · {quote.items.length} 行报价</span></div>
      <table className="fp-quote-table"><colgroup><col className="fp-col-product" /><col className="fp-col-room" /><col className="fp-col-quantity" /><col className="fp-col-money" /><col className="fp-col-money" /><col className="fp-col-money" /></colgroup><thead><tr><th>产品 / 规格与说明</th><th>房间</th><th>数量</th><th>原单价</th><th>折后单价</th><th>折后小计</th></tr></thead><tbody>{chunk.map((item) => <tr key={item.lineId}><td><strong>{item.name}</strong><span>{[item.brand, item.sku].filter(Boolean).join(" · ")}</span>{item.spec ? <span>{item.spec}</span> : null}<span className="fp-verification">{quoteVerificationLabel(item)}</span>{verificationReasons(item) ? <span className="fp-verification-reason">{verificationReasons(item)}</span> : null}</td><td>{item.room || "全屋"}</td><td>{item.quantity}<br />{item.unit || "个"}</td><td>{money(item.price)}</td><td>{money(deliveryLineUnitPrice(item))}</td><td><strong>{money(deliveryLineTotal(item))}</strong></td></tr>)}</tbody></table>
      {index === chunks.length - 1 || !chunks.length ? <div className="fp-quote-summary"><div><span>产品原价</span><strong>{money(quote.subtotal)}</strong></div><div><span>优惠金额</span><strong>{money(quote.discount)}</strong></div><div><span>安装调试</span><strong>{money(quote.installationFee)}</strong></div><div><span>本版应收总额</span><strong>{money(quote.total)}</strong></div></div> : <p className="fp-quote-continued">报价明细续下页；完整合计见本组末页。</p>}
      <p className="fp-scope-note">{QUOTE_SCOPE_NOTE}</p><p className="fp-scope-note">未核验报价用于方案沟通，不等同于正式采购确认。型号、配套用料、实测数量与安装条件应在后续逐项核对。</p>
    </> : <p className="fp-empty">本版尚未保存报价，暂无可列示的产品金额。</p>}
  </Page>)
}

function FloorPlans({ snapshot, floors, ...common }: { snapshot: ProjectDeliverySnapshot; floors: PointMapPrintFloor[]; brand: DocumentBrand; demo: boolean }) {
  return floors.map((floor) => <Page key={floor.id} snapshot={snapshot} {...common} label={`${floor.name} · 点位设计`} className="fp-floor-page">
    <Heading title={floor.name} description="设备点位与空间布置 · 本版本原图完整呈现" aside={versionLabel(snapshot)} />
    <div className="fp-floor-image"><img src={floor.src} alt={`${floor.name}完整点位设计图`} /></div>
    <p className="fp-scope-note">{snapshot.version > 0 ? "本图复用同一固定版本的楼层图。" : "本图为已保存资料预览，尚未形成固定交付版本。"}实际安装位置、回路与施工条件需结合现场核对，未定位设备见后续沟通清单。</p>
  </Page>)
}

function Confirmation({ snapshot, brand, demo }: { snapshot: ProjectDeliverySnapshot; brand: DocumentBrand; demo: boolean }) {
  const unplaced = snapshot.plan.points.filter((point) => !point.placed)
  const unverified = snapshot.quote?.items.filter((item) => quoteVerification(item).status === "unverified") ?? []
  const proposed = snapshot.plan.scenes?.filter((scene) => scene.status !== "confirmed") ?? []
  const quotedPointIds = new Set((snapshot.quote?.items ?? []).flatMap((item) => item.pointIds ?? []))
  const pointsToCheck = snapshot.plan.points.filter((point) => !quotedPointIds.has(point.id) && point.usage !== "reserve" && point.usage !== "proposed")
  const longContent = unplaced.reduce((sum, point) => sum + pointName(point).length, 0) + proposed.reduce((sum, scene) => sum + scene.name.length, 0) > 180
  return <Page snapshot={snapshot} brand={brand} demo={demo} label="沟通与确认" className={`fp-confirmation-page${longContent ? " fp-long-confirmation" : ""}`}>
    <Heading title="把喜欢的生活，慢慢确认下来。" description="初次提案的重点，是找到方向、讲清范围，再一起完善细节。" />
    <div className="fp-next-steps"><h3>建议的下一次沟通</h3><ol><li><strong>先选生活体验</strong><p>哪些场景最贴近您的日常？哪些功能不需要？把优先级、操作习惯与家人需求说明白。</p></li><li><strong>再定空间与配置</strong><p>逐个空间核对位置、外观与型号，结合现场明确回路、网络、配套用料和实测数量。</p></li><li><strong>共同确认报价范围</strong><p>确认保留项、调整项与未报范围。确认后的变化形成新版本，方便对照。</p></li></ol></div>
    <div className="fp-confirm-grid"><div><h3>本版待沟通事项</h3><ul>{proposed.length ? <li>{proposed.length} 项场景待确认：{proposed.map((scene) => scene.name).join("、")}</li> : <li>生活场景与操作习惯可在沟通时继续补充。</li>}{unplaced.length ? <li>{unplaced.length} 处设备待定位：{unplaced.map(pointName).join("、")}</li> : null}{unverified.length ? <li>{unverified.length} 行产品尚未核验，具体原因及未报配套见完整报价。</li> : null}<li>设计点位不等于已报价范围。预留、待评估点位不直接形成采购数量。</li>{pointsToCheck.length ? <li>{pointsToCheck.length} 处点位尚未与报价行明确关联，需核对是否已由手动报价覆盖，再确认范围。</li> : null}<li>工期、付款、质保及售后范围：待双方另行约定，本提案不预设承诺。</li></ul></div><div><h3>您的想法</h3><p>想保留的体验 / 需要调整的地方</p><div className="fp-note-lines" aria-hidden="true"><span /><span /><span /></div></div></div>
    <div className="fp-confirmation-sign"><div><span>客户沟通确认</span><i /></div><div><span>沟通日期</span><i /></div></div>
    <p className="fp-confirmation-note">此处用于记录本次沟通意见；范围、价格及双方权利义务以另行确认的文件为准。</p>
    <div className="fp-closing"><div><h3>为日常留一点从容。</h3><Brand brand={brand} closing /></div>{brand.qrSrc ? <figure><img src={brand.qrSrc} alt="联系二维码" /><figcaption>扫码联系</figcaption></figure> : null}</div>
  </Page>
}

/** All content comes from one immutable delivery; the component never fetches or reprices products. */
export function FirstProposalDocument({ snapshot, floors, brand, theme, documentRef, demo = false }: FirstProposalDocumentProps) {
  const rooms = projectRooms(snapshot)
  const common = { snapshot, brand, demo }
  return <article ref={documentRef} className={`first-proposal-document fp-theme-${theme}`} data-proposal-theme={theme}>
    <Cover {...common} theme={theme} />
    <Overview {...common} rooms={rooms} />
    <Scenes {...common} theme={theme} />
    <Products {...common} theme={theme} />
    <Budget {...common} rooms={rooms} />
    <QuoteDetails {...common} />
    <FloorPlans {...common} floors={floors} />
    <Confirmation {...common} />
  </article>
}
