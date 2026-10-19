import { describe, expect, it } from "vitest"
import { catalogQuotationVerification, quoteVerification, quoteVerificationLabel } from "../lib/quote-verification"

describe("quotation verification", () => {
  it("does not claim a legacy or incomplete quote has been verified", () => {
    expect(quoteVerificationLabel({})).toBe("未核验")
    expect(catalogQuotationVerification({ catalogKind: "series", selectionStatus: "verified", selectionEvidence: "evidence", pricingStatus: "pending" }).status).toBe("unverified")
    expect(quoteVerification({ productSnapshot: { quotationVerification: { status: "verified" } } }).status).toBe("unverified")
  })
  it("keeps an issued default-model warning unchanged through JSON round trips", () => {
    const item = { productSnapshot: { quotationVerification: { status: "unverified", source: "default", reasons: ["默认型号尚未逐点确认"] } } }
    expect(quoteVerificationLabel(JSON.parse(JSON.stringify(item)))).toBe("未核验 · 默认型号")
    expect(quoteVerification(item).reasons).toEqual(["默认型号尚未逐点确认"])
    quoteVerification(item).reasons.push("later")
    expect(item.productSnapshot.quotationVerification.reasons).toHaveLength(1)
  })
})
