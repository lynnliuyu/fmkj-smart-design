import Image from "next/image"
import * as React from "react"

import { DocumentBrandMark, DocumentContactCard, DocumentPrintFooter } from "@/components/business/document-brand"
import { DOCUMENT_BRAND, type DocumentBrand } from "@/lib/document-brand"
import { needsDirectImageLoad } from "@/lib/image-src"
import { deliveryLineTotal, deliveryLineUnitPrice } from "@/lib/project-delivery"
import type { PointMapPrintFloor } from "@/lib/point-map-print"
import { money, type QuoteLineItem as QuoteItem, type QuoteProductOption as ProductOption } from "@/lib/quote-authoring"
import { quoteVerification, quoteVerificationLabel } from "@/lib/quote-verification"
import { quoteDisplaySpec } from "@/lib/quote-spec"

export type QuotePrintFloorImage = PointMapPrintFloor

/**
 * 客户报价单的固定内容：导出时先用服务器已保存的报价和同一个交付版本填满这个快照，
 * 再由 QuotePrintDocument 打印。这里只放打印要用的字段，不带任何取数逻辑。
 */
export type QuotePrintSnapshot = {
  deliveryVersion: number
  quoteNo: string
  date: string
  discountTotal: number
  floorImages: QuotePrintFloorImage[]
  groups: Array<{ name: string; items: QuoteItem[] }>
  installationFee: number
  project: string
  status: string
  subtotal: number
  total: number
}

export type QuotePrintDocumentProps = QuotePrintSnapshot & {
  brand: DocumentBrand
  documentRef: React.Ref<HTMLElement>
}

/** 「报价含基础安装调试」的客户说明；页面上与打印件共用同一句话。 */
const QUOTE_NOTE = "报价含基础安装调试，不含强电改造和额外布线费用。最终金额以现场复核和客户确认版本为准。"

/**
 * 客户看得懂的那一版报价单。版式沿用「现代简约」视觉：品牌页头、大字应收合计、
 * 每个分组一张卡片、费用构成与签字收尾，楼层点位图仍然每层一页。
 *
 * 只换外观：列语义、金额、核验标识与配套未计入说明都保持原样（ADR 0006、0011）。
 */
export function QuotePrintDocument({
  brand,
  date,
  deliveryVersion,
  discountTotal,
  documentRef,
  floorImages,
  groups,
  installationFee,
  project,
  quoteNo,
  status,
  subtotal,
  total,
}: QuotePrintDocumentProps) {
  // 房间清单里没有产品的分组不印空卡片。
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  // 打印件的金额口径与旧版式一致（页面摘要区另有折扣行，两者本来就不同，这次不改）。
  // 产品合计是折后值：subtotal − discountTotal。
  const productSubtotal = subtotal - discountTotal
  const deviceCount = visibleGroups.reduce(
    (sum, group) => sum + group.items.reduce((groupSum, item) => groupSum + item.quantity, 0),
    0
  )
  const lineCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <article className="quote-document hidden" ref={documentRef}>
      <header className="quote-document-hero">
        <div className="quote-document-brandline">
          <DocumentBrandMark brand={brand} />
        </div>
        <div className="quote-document-docno">
          <span>报价编号</span>
          <strong>{quoteNo}</strong>
          {deliveryVersion > 0 ? <span>方案版本 V{deliveryVersion}</span> : null}
        </div>
      </header>

      <div className="quote-document-title">
        <h1>智能家居方案报价单</h1>
        <div className="quote-document-rule" aria-hidden="true" />
        <p className="quote-document-project">{project}</p>
      </div>

      <section className="quote-document-meta" aria-label="报价信息">
        <div className="quote-document-fact">
          <span>客户项目</span>
          <strong>{project}</strong>
        </div>
        <div className="quote-document-fact">
          <span>报价状态</span>
          <strong>{status}</strong>
        </div>
        <div className="quote-document-fact">
          <span>有效期</span>
          <strong>15 天</strong>
        </div>
        <div className="quote-document-fact">
          <span>报价日期</span>
          <strong>{date || "—"}</strong>
        </div>
      </section>

      <section className="quote-document-total" aria-label="应收合计">
        <div className="quote-document-grand">
          <span>应收合计</span>
          <strong>{money(total)}</strong>
        </div>
        <div className="quote-document-total-grid quote-document-total-grid-compact">
          <div>
            <span>产品合计</span>
            <strong>{money(productSubtotal)}</strong>
          </div>
          <div>
            <span>调试安装费用</span>
            <strong>{money(installationFee)}</strong>
          </div>
          <div>
            <span>报价总价</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
      </section>

      <section className="quote-document-sections" aria-label="报价明细">
        <div className="quote-document-cols">
          <div>
            <h2>报价明细</h2>
            <span>
              共 {visibleGroups.length} 组 · {lineCount} 行 · {deviceCount} 件
            </span>
          </div>
          <div className="quote-document-cols-labels" aria-hidden="true">
            <span className="c-amount">数量</span>
            <span className="c-amount">单价</span>
            <span className="c-amount">总价</span>
          </div>
        </div>
        {visibleGroups.map((group) => {
          const groupTotal = group.items.reduce((sum, item) => sum + deliveryLineTotal(item), 0)
          const groupUnits = group.items.reduce((sum, item) => sum + item.quantity, 0)

          return (
            <section key={group.name} className="quote-document-section">
              <div className="quote-document-section-title">
                <h2>{group.name}</h2>
                <span className="quote-document-section-count">
                  {group.items.length} 行 · {groupUnits} 件
                </span>
                <span className="quote-document-section-sum">
                  <span className="quote-document-section-sum-label">分组小计</span>
                  <strong>{money(groupTotal)}</strong>
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>规格</th>
                    <th>房间</th>
                    <th className="c-amount">数量</th>
                    <th className="c-amount">单价</th>
                    <th className="c-amount">总价</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.lineId}>
                      <td>
                        <div className="quote-document-product">
                          <ProductThumb product={item} eager />
                          <div className="quote-document-product-text">
                            <strong>{item.name}</strong>
                            <span>{item.category}</span>
                            <span
                              className="quote-document-verify"
                              data-verification={quoteVerification(item).status}
                              title={quoteVerification(item).reasons.join("；")}
                            >
                              {quoteVerificationLabel(item)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="quote-document-spec">{quoteDisplaySpec(item.spec, item.name) || "—"}</td>
                      <td className="quote-document-room">{item.room}</td>
                      <td className="quote-document-num">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="quote-document-num">{money(deliveryLineUnitPrice(item))}</td>
                      <td className="quote-document-num quote-document-line-total">{money(deliveryLineTotal(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}
      </section>

      {/* 收尾区按子块自然流动：每个子块自己不许内部断开，但不把它们整体推到下一页，
          否则品牌数据填全时第一页会剩半页空白、正文还多出一页。 */}
      <section className="quote-document-closing">
        <div className="quote-document-fees">
          <h2>费用构成</h2>
          <div className="quote-document-fee-row">
            <span>产品合计</span>
            <strong>{money(productSubtotal)}</strong>
          </div>
          <div className="quote-document-fee-row">
            <span>调试安装费用</span>
            <strong>{money(installationFee)}</strong>
          </div>
          <div className="quote-document-fee-total">
            <span>报价总价</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
        <div className="quote-document-notes">
          <h2>报价说明</h2>
          <p>{QUOTE_NOTE}</p>
        </div>
      </section>

      {/* 旧版式页脚里的署名与「客户报价专用文件」照旧保留。 */}
      <div className="quote-document-brandfoot">
        <strong>{brand.companyName || DOCUMENT_BRAND.companyName}</strong>
        <span>客户报价专用文件</span>
      </div>

      {/* 客户确认签字：只有这一栏，文字与旧版式一致（签字 / 日期），换的只是外观。 */}
      <section className="quote-document-sign" aria-label="客户确认">
        <h2>客户确认</h2>
        <div className="quote-document-sign-row">
          <span>签字</span>
          <span className="quote-document-sign-line" />
        </div>
        <div className="quote-document-sign-row">
          <span>日期</span>
          <span className="quote-document-sign-line" />
        </div>
      </section>

      {/* 联系我们（DocumentContactCard）自带避断外壳，避免二维码与文字被拆到两页。 */}
      <div className="quote-document-contact">
        <DocumentContactCard brand={brand} />
      </div>

      <section className="quote-document-floors" aria-label="楼层点位图">
        {floorImages.map(({ id, name, src }) => (
          <figure key={id || name}>
            <div className="quote-document-floor-kicker">楼层点位图</div>
            {/* 点位图是运行时生成的 blob URL，Next 的图片优化对它没有意义 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${name} 点位方案`} />
            <figcaption>{name} · 点位方案</figcaption>
          </figure>
        ))}
      </section>

      <DocumentPrintFooter brand={brand} />
    </article>
  )
}

function ProductThumb({ product, eager = false }: { product: ProductOption; eager?: boolean }) {
  return (
    <div className="quote-document-thumb">
      <Image
        loading={eager ? "eager" : "lazy"}
        src={product.image}
        alt=""
        fill
        unoptimized={needsDirectImageLoad(product.image)}
        className="object-contain p-1"
        sizes="40px"
      />
    </div>
  )
}
