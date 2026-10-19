/** Exclude empty, unsafe and placeholder URLs from product-photo updates. */
export function usableProductImage(value: string | null | undefined): string | undefined {
  const src = value?.trim()
  if (!src) return undefined
  try {
    const url = new URL(src, "https://point-map.local")
    if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) return undefined
    if (url.protocol === "data:" && !/^data:image\//i.test(src)) return undefined
    if (/(?:^|\/)placeholder(?:[-_.\/]|$)/i.test(decodeURIComponent(url.pathname))) return undefined
    return src
  } catch {
    return undefined
  }
}
