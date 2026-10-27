/**
 * Referential marks for first proposals. Identity comes only from the saved
 * quotation's `brand` field; product names and later catalogue data are not used.
 */
export type ProposalBrandKind = "brand" | "ecosystem" | "protocol"

export type ProposalBrandAsset = Readonly<{
  id: string
  name: string
  kind: ProposalBrandKind
  logoSrc: string | null
  sourceUrl: string | null
  assetSourceUrl: string | null
  usageNote: string
  verifiedOn: string | null
}>

type KnownBrand = ProposalBrandAsset & { aliases: readonly string[] }

const REFERENTIAL_USE = "仅用于识别本方案已保存的产品品牌，不表示品牌授权、合作或兼容认证。"

const KNOWN_BRANDS: readonly KnownBrand[] = [
  {
    id: "aqara", name: "Aqara 绿米", kind: "brand",
    aliases: ["aqara", "绿米", "绿米联创", "aqara绿米", "aqara 绿米", "绿米 aqara", "绿米/aqara", "aqara/绿米"],
    logoSrc: "/assets/proposals/brands/aqara.svg",
    sourceUrl: "https://www.aqara.com/en/about-us/brand-story/",
    assetSourceUrl: "https://www.aqara.com/wp-content/uploads/2023/03/aqara_logo.svg",
    usageNote: REFERENTIAL_USE, verifiedOn: "2026-10-23",
  },
  {
    id: "xiaomi", name: "小米 Xiaomi", kind: "brand",
    aliases: ["小米", "xiaomi", "小米 xiaomi", "xiaomi 小米", "小米科技"],
    logoSrc: "/assets/proposals/brands/xiaomi.png",
    sourceUrl: "https://www.mi.com/",
    assetSourceUrl: "https://i01.appmifile.com/webfile/globalimg/mobile/logo/mi.png",
    usageNote: REFERENTIAL_USE, verifiedOn: "2026-10-23",
  },
  {
    id: "mijia", name: "米家 MIJIA", kind: "brand",
    aliases: ["米家", "mijia", "米家 mijia", "mijia 米家"],
    logoSrc: "/assets/proposals/brands/mijia.png",
    sourceUrl: "https://home.mi.com/",
    assetSourceUrl: "https://cdn.web-global.fds.api.mi-img.com/mijia/prod/home/main.ec78fdc73e.js",
    usageNote: `${REFERENTIAL_USE} 图形来自米家官网页头，不使用“已接入米家”认证章。`,
    verifiedOn: "2026-10-23",
  },
  {
    id: "yeelight", name: "Yeelight 易来", kind: "brand",
    aliases: ["yeelight", "易来", "yeelight 易来", "易来 yeelight", "yeelight pro", "易来pro", "易来 pro"],
    logoSrc: "/assets/proposals/brands/yeelight.png",
    sourceUrl: "https://en.yeelight.com/",
    assetSourceUrl: "https://en.yeelight.com/wp-content/uploads/sites/4/2022/07/Yeelight-Logo-05.png",
    usageNote: REFERENTIAL_USE, verifiedOn: "2026-10-23",
  },
  {
    id: "apple", name: "Apple 苹果", kind: "brand",
    aliases: ["apple", "苹果", "apple 苹果", "苹果 apple"],
    logoSrc: null,
    sourceUrl: "https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html",
    assetSourceUrl: null,
    usageNote: "使用文字识别品牌；未提供销售宣传物料的图形授权，故不展示 Apple 图形商标。",
    verifiedOn: "2026-10-23",
  },
  {
    id: "apple-home", name: "Apple Home", kind: "ecosystem",
    aliases: ["apple home", "apple homekit", "homekit", "苹果家庭", "苹果 home", "苹果home", "苹果homekit"],
    logoSrc: null,
    sourceUrl: "https://www.apple.com/home-app/",
    assetSourceUrl: null,
    usageNote: "智能家居生态名称，不是设备品牌；不能据此认定报价内产品已获得兼容认证。",
    verifiedOn: "2026-10-23",
  },
  {
    id: "xiaomi-home", name: "Xiaomi Home / 米家 App", kind: "ecosystem",
    aliases: ["xiaomi home", "mi home", "米家app", "米家 app", "小米智能家庭"],
    logoSrc: null,
    sourceUrl: "https://home.mi.com/",
    assetSourceUrl: null,
    usageNote: "智能家居生态名称，与米家、小米产品品牌分别表达，不据此推断接入能力。",
    verifiedOn: "2026-10-23",
  },
  {
    id: "matter", name: "Matter", kind: "protocol",
    aliases: ["matter"],
    logoSrc: null,
    sourceUrl: "https://csa-iot.org/all-solutions/matter/",
    assetSourceUrl: null,
    usageNote: "通信标准名称，不是设备品牌；不能将名称出现视为该项目或产品获得认证。",
    verifiedOn: "2026-10-23",
  },
]

/** Exact alias matching after typography normalization; never substring matching. */
export function normalizeProposalBrand(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}

const ALIASES = new Map(KNOWN_BRANDS.flatMap((brand) => brand.aliases.map((alias) => [normalizeProposalBrand(alias), brand] as const)))

/** Ecosystem / protocol results are classified, so callers need not present them as brands. */
export function resolveProposalBrand(value: string | null | undefined): ProposalBrandAsset | null {
  const key = normalizeProposalBrand(value)
  if (!key) return null
  const known = ALIASES.get(key)
  if (known) {
    const { aliases: _aliases, ...asset } = known
    return asset
  }
  return {
    id: `custom:${key}`, name: value!.trim(), kind: "brand", logoSrc: null,
    sourceUrl: null, assetSourceUrl: null, verifiedOn: null,
    usageNote: "按已保存报价显示品牌原文；暂无已核对的图形标识，使用文字展示。",
  }
}

/** Only saved brand fields, in quotation order; unknown brands retain a text fallback. */
export function collectProposalBrands(items: readonly { brand?: string | null }[]): ProposalBrandAsset[] {
  const result: ProposalBrandAsset[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const brand = resolveProposalBrand(item.brand)
    if (!brand || brand.kind !== "brand" || seen.has(brand.id)) continue
    seen.add(brand.id)
    result.push(brand)
  }
  return result
}
