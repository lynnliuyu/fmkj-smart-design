/**
 * Reports which product images under public/assets/products are actually used.
 *
 * "Used" means referenced by products.image, product_visual_assets, or embedded in a
 * stored quote / delivery snapshot. Those snapshots are why an image that no current
 * product points at can still be needed: history keeps its own copy of the path.
 *
 * Usage: pnpm products:audit
 * Needs DATABASE_URL in .env.local (read only, it never writes).
 */
import { PRODUCT_IMAGE_ROOT, analyseProductImages, megabytes } from "./lib/product-image-usage.mjs"

const { files, referenced, unused, dangling, unusedBytes } = await analyseProductImages()

const prefix = `${PRODUCT_IMAGE_ROOT.replace(/^public/, "")}/`
const groups = new Map()
for (const file of unused) {
  const dir = file.url.replace(prefix, "").split("/").slice(0, -1).join("/") || "(根)"
  const bucket = groups.get(dir) ?? { count: 0, bytes: 0 }
  bucket.count += 1
  bucket.bytes += file.size
  groups.set(dir, bucket)
}

console.log(`磁盘 ${files.length} 个文件`)
console.log(`数据库（含报价与交付快照）引用 ${referenced.size} 个路径`)
console.log(`从未被引用 ${unused.length} 个, ${megabytes(unusedBytes)} MB`)
console.log(`引用但磁盘缺失 ${dangling.length}`)
for (const url of dangling.slice(0, 12)) console.log(`  缺失 ${url}`)
console.log("未引用分布:")
for (const [dir, bucket] of [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${dir}: ${bucket.count} 个, ${megabytes(bucket.bytes)} MB`)
}
console.log("未引用的最大 10 个:")
for (const file of [...unused].sort((a, b) => b.size - a.size).slice(0, 10)) {
  console.log(`  ${Math.round(file.size / 1024)} KB  ${file.url}`)
}
