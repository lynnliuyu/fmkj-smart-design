import Image from "next/image"

import { DOCUMENT_BRAND, resolveDocumentBrand, type DocumentBrand } from "@/lib/document-brand"

/**
 * 打印文档左上角的署名。客户在后台填了公司名/logo 就用客户的——
 * 设备发给最终客户看的报价单上不该出现供货方的品牌。
 */
export function DocumentBrandMark({ brand }: { brand?: DocumentBrand } = {}) {
  const effective = brand ?? resolveDocumentBrand()
  return (
    <div className="document-brand">
      <Image src={effective.logoSrc} alt="" width={44} height={44} loading="eager" unoptimized />
      <div className="document-brand-text">
        <strong>{effective.companyName}</strong>
        {/* 联系方式与地址是可选的：没填就不占版面。 */}
        {effective.contact ? <span>{effective.contact}</span> : null}
        {effective.address ? <span>{effective.address}</span> : null}
      </div>
    </div>
  )
}

/**
 * 文档末尾的「联系我们」：客户要联系门店时最常看的地方。
 * 没有二维码就只印联系方式与地址；两样都没有就整块不出现。
 */
export function DocumentContactCard({ brand }: { brand?: DocumentBrand } = {}) {
  const effective = brand ?? resolveDocumentBrand()
  const hasText = Boolean(effective.contact || effective.address)
  if (!effective.qrSrc && !hasText) return null

  return (
    <section className="document-contact">
      <div>
        <strong>{effective.companyName}</strong>
        {effective.contact ? <p>联系方式：{effective.contact}</p> : null}
        {effective.address ? <p>门店地址：{effective.address}</p> : null}
      </div>
      {effective.qrSrc ? (
        <figure>
          {/* 打印文档里用原生 img：Next 的图片优化对打印没有意义 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="扫码联系我们" src={effective.qrSrc} />
          <figcaption>扫码联系我们</figcaption>
        </figure>
      ) : null}
    </section>
  )
}

/** Page margin boxes repeat even when the print document is absolutely positioned. */
export function DocumentPrintFooter({ brand }: { brand?: DocumentBrand } = {}) {
  const effective = brand ?? { companyName: DOCUMENT_BRAND.companyName, logoSrc: DOCUMENT_BRAND.logoSrc }
  return (
    <style>{`@media print {
      @page {
        @bottom-center {
          content: "${effective.companyName}";
          font-family: Arial, sans-serif;
          font-size: 8pt;
          font-weight: 400;
          color: #475569;
          vertical-align: middle;
        }
      }
    }`}</style>
  )
}
