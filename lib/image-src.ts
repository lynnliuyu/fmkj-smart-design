// Next 的图片优化接口不处理 SVG（返回 400），SVG 产品图要直接加载。
export const isSvgImage = (src: string | null | undefined) => /\.svg(?:[?#]|$)/i.test(src ?? "")


/**
 * 需要绕过 Next 图片优化的来源。
 *
 * Next 的 `/_next/image?url=...` 会由服务端去取图，取图时**不带浏览器会话**，
 * 而 `/api/files/...` 是「必须登录才能看」的私有附件（合同、户型图、产品图都在这里），
 * 于是优化接口一律 400，客户那边看到的就是一排破图（设备版真机上实测）。
 * 这类图必须让浏览器直接请求，才能带上 Cookie。
 *
 * SVG 也是同样的处理：优化接口不处理 SVG。
 */
export const needsDirectImageLoad = (src: string | null | undefined): boolean => {
  const value = src ?? ""
  return isSvgImage(value) || value.startsWith("/api/files/")
}
