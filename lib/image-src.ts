// Next 的图片优化接口不处理 SVG（返回 400），SVG 产品图要直接加载。
export const isSvgImage = (src: string | null | undefined) => /\.svg(?:[?#]|$)/i.test(src ?? "")
