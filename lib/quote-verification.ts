import type { ProductSelectionFields } from "./product-selection"

export type QuotationVerification = { status: "verified" | "unverified"; source: "default" | "selection" | "catalog"; reasons: string[] }

/** Quote permission and procurement verification are different facts. */
export function catalogQuotationVerification(product?: ProductSelectionFields): QuotationVerification {
  const reasons: string[] = []
  if (product?.catalogKind !== "sku") reasons.push("具体供货规格尚未核验")
  if (product?.selectionStatus !== "verified" || !product.selectionEvidence?.trim()) reasons.push("产品参数尚未核验")
  if (product?.pricingStatus !== "verified" || !product.pricingEvidence?.trim()) reasons.push("价格尚未核验")
  return { status: reasons.length ? "unverified" : "verified", source: "catalog", reasons }
}

/** Historical rows without a recorded verification must never be promoted by today's catalog. */
export function quoteVerification(item: { productSnapshot?: Record<string, unknown> }): QuotationVerification {
  const value = item.productSnapshot?.quotationVerification as Partial<QuotationVerification> | undefined
  if (value && (value.status === "verified" || value.status === "unverified") &&
      (value.source === "default" || value.source === "selection" || value.source === "catalog") &&
      Array.isArray(value.reasons) && value.reasons.every((reason) => typeof reason === "string")) {
    return { status: value.status, source: value.source, reasons: [...value.reasons] }
  }
  return { status: "unverified", source: "catalog", reasons: ["此报价未记录核验结果"] }
}

export function quoteVerificationLabel(item: { productSnapshot?: Record<string, unknown> }): string {
  const verification = quoteVerification(item)
  const label = verification.status === "verified" ? "资料已核验" : verification.source === "default" ? "未核验 · 默认型号" : "未核验"
  // Scope omissions must stay visible in quote tables, both PDFs and CSV, beyond a hover title.
  const scope = verification.reasons.filter((reason) => reason.startsWith("配套未计入本次报价："))
  return [label, ...scope].join(" · ")
}
