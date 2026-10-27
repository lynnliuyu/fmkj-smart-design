/** 客户面文档（报价单、方案）上的署名。默认是官方品牌；设备版允许客户在自己后台改。 */
export const DOCUMENT_BRAND = {
  companyName: "繁梦空间智能设计",
  logoSrc: "/assets/brand/fmkj-copilot.png",
} as const

export type DocumentBrand = {
  address: string
  companyName: string
  contact: string
  logoSrc: string
  qrSrc: string
}

export const BRAND_NAME_KEY = "BRAND_NAME"
export const BRAND_LOGO_KEY = "BRAND_LOGO_URL"
export const BRAND_CONTACT_KEY = "BRAND_CONTACT"
export const BRAND_ADDRESS_KEY = "BRAND_ADDRESS"
export const BRAND_QR_KEY = "BRAND_QR_URL"

/**
 * 算出这份文档实际用谁的名字。
 * 客户在「管理员 → 系统 → 系统配置」里填了就用自己的，没填就用官方默认——
 * 设备发给最终客户看的报价单上，不该出现供货方的品牌。
 */
export function resolveDocumentBrand(
  settings: ReadonlyArray<{ key: string; value?: string | null }> | Record<string, string | null | undefined> = [],
): DocumentBrand {
  const read = (key: string) =>
    (Array.isArray(settings)
      ? settings.find((setting) => setting.key === key)?.value
      : (settings as Record<string, string | null | undefined>)[key]) ?? ""

  const companyName = String(read(BRAND_NAME_KEY)).trim()
  const logoSrc = String(read(BRAND_LOGO_KEY)).trim()
  return {
    // 联系方式、地址、二维码是可选的：没填就不印那一行，不会留空白。
    address: String(read(BRAND_ADDRESS_KEY)).trim(),
    companyName: companyName || DOCUMENT_BRAND.companyName,
    contact: String(read(BRAND_CONTACT_KEY)).trim(),
    logoSrc: logoSrc || DOCUMENT_BRAND.logoSrc,
    qrSrc: String(read(BRAND_QR_KEY)).trim(),
  }
}
