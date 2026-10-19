/** A reusable display derivative. Product identity, pricing and the original image stay separate. */
export type ProductVisualAsset = {
  image: string
  sourceImage: string
  crop: { x: number; y: number; width: number; height: number } | null
  scale: number
  reviewStatus: "pending" | "series" | "verified"
  revision: number
  updatedAt: string
  evidence?: string
}

export type ProductVisualAssetMutation = Pick<ProductVisualAsset, "image" | "sourceImage" | "crop" | "scale" | "reviewStatus" | "evidence"> & {
  expectedRevision: number
}

export const productVisualReviewLabels = {
  pending: "待补图 / 待核",
  series: "系列示意图",
  verified: "准确型号净图",
} as const

export class ProductVisualValidationError extends Error {
  constructor(public details: Record<string, string>, public status = 400) {
    super("PRODUCT_VISUAL_VALIDATION_ERROR")
    this.name = "ProductVisualValidationError"
  }
}

/** Restrict display URLs without fetching them on the application server. */
export function validProductVisualImage(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value !== value.trim() || /[\u0000-\u0020\\]/.test(value)) return false
  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      const decoded = decodeURIComponent(value.split(/[?#]/)[0])
      return !decoded.split("/").some((part) => part === ".." || part === ".") && !/[\\\u0000-\u001f]/.test(decoded)
    } catch { return false }
  }
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

export function parseProductVisualAssetMutation(input: unknown): ProductVisualAssetMutation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProductVisualValidationError({ visual: "请提交商品展示图资料" })
  const body = input as Record<string, unknown>
  const details: Record<string, string> = {}
  const allowed = new Set(["image", "sourceImage", "crop", "scale", "reviewStatus", "evidence", "expectedRevision"])
  if (Object.keys(body).some((key) => !allowed.has(key))) details.visual = "展示图接口只接受图片、裁切、大小、核验资料和版本"
  if (!validProductVisualImage(body.image)) details.image = "展示图片须为站内路径或有效的 HTTP(S) 图片地址"
  if (!validProductVisualImage(body.sourceImage)) details.sourceImage = "请填写有效的原始图片地址"
  if (typeof body.scale !== "number" || !Number.isFinite(body.scale) || body.scale < 0.5 || body.scale > 2) details.scale = "主体大小须在 0.5 至 2 之间"
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) details.expectedRevision = "请携带最新展示图版本"
  if (!["pending", "series", "verified"].includes(String(body.reviewStatus))) details.reviewStatus = "请选择有效的图片核验状态"
  if (body.evidence !== undefined && (typeof body.evidence !== "string" || body.evidence.length > 4000)) details.evidence = "图片依据须为不超过 4000 字的文字"
  const evidence = typeof body.evidence === "string" ? body.evidence.trim() : ""
  if (body.reviewStatus === "verified" && !evidence) details.evidence = "准确型号图请记录厂家页面或可复核的图片依据"
  let crop: ProductVisualAsset["crop"] = null
  if (body.crop !== null) {
    if (!body.crop || typeof body.crop !== "object" || Array.isArray(body.crop)) details.crop = "裁切须为空或包含归一化的 x、y、width、height"
    else {
      const frame = body.crop as Record<string, unknown>
      const values = [frame.x, frame.y, frame.width, frame.height]
      if (Object.keys(frame).length !== 4 || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) details.crop = "裁切坐标须为有限数字"
      else {
        const { x, y, width, height } = frame as NonNullable<ProductVisualAsset["crop"]>
        if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) details.crop = "裁切范围不能超出原图，宽高必须大于 0"
        else crop = { x, y, width, height }
      }
    }
  }
  if (Object.keys(details).length) throw new ProductVisualValidationError(details)
  return {
    image: body.image as string, sourceImage: body.sourceImage as string, crop,
    scale: body.scale as number, reviewStatus: body.reviewStatus as ProductVisualAsset["reviewStatus"],
    expectedRevision: body.expectedRevision as number, evidence,
  }
}

export function defaultProductVisualAsset(image: string | null, updatedAt: string): ProductVisualAsset {
  return { image: image ?? "", sourceImage: image ?? "", crop: null, scale: 1, reviewStatus: "pending", revision: 0, updatedAt, evidence: "" }
}
