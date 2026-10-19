import Image from "next/image"
import { DOCUMENT_BRAND } from "@/lib/document-brand"

export function DocumentBrand() {
  return (
    <div className="document-brand">
      <Image src={DOCUMENT_BRAND.logoSrc} alt="" width={44} height={44} loading="eager" unoptimized />
      <strong>{DOCUMENT_BRAND.companyName}</strong>
    </div>
  )
}

/** Page margin boxes repeat even when the print document is absolutely positioned. */
export function DocumentPrintFooter() {
  return (
    <style>{`@media print {
      @page {
        @bottom-center {
          content: "${DOCUMENT_BRAND.companyName}";
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
