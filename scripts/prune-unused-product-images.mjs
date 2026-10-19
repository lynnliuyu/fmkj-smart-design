/**
 * Moves product images that nothing references out of `public/`, so they stop shipping
 * with the app, while keeping a local copy and a committed manifest.
 *
 * Dry run by default. With `--apply` each file goes to
 * `.local/unused-product-images/<same relative path>` (git ignored) and a manifest is
 * written to `docs/reports/product-images-unused-<date>.csv`. Nothing is deleted, and
 * the files also stay in git history, so this is reversible.
 *
 * Usage:
 *   pnpm products:prune           # report only
 *   pnpm products:prune --apply   # move files + write manifest
 *
 * Needs DATABASE_URL in .env.local (read only).
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { PRODUCT_IMAGE_ROOT, analyseProductImages, megabytes } from "./lib/product-image-usage.mjs"

const apply = process.argv.includes("--apply")
const destinationRoot = ".local/unused-product-images"

const { files, referenced, unused, dangling, unusedBytes } = await analyseProductImages()

console.log(`磁盘 ${files.length} 个文件，数据库引用 ${referenced.size} 个路径`)
console.log(`未被引用 ${unused.length} 个，${megabytes(unusedBytes)} MB`)
console.log(`引用但磁盘缺失 ${dangling.length} 个`)

if (dangling.length > 0) {
  console.log("数据库指向了不存在的文件，先修数据再清理；本次不做任何改动。")
  for (const url of dangling.slice(0, 12)) console.log(`  缺失 ${url}`)
  process.exit(1)
}

if (unused.length === 0) {
  console.log("没有可清理的图片。")
  process.exit(0)
}

if (!apply) {
  console.log(`\n预演：加 --apply 会把以上文件移到 ${destinationRoot}/ 并生成清单。`)
  for (const file of [...unused].sort((a, b) => b.size - a.size).slice(0, 10)) {
    console.log(`  ${Math.round(file.size / 1024)} KB  ${file.url}`)
  }
  process.exit(0)
}

const today = new Date().toISOString().slice(0, 10)
const manifestPath = `docs/reports/product-images-unused-${today}.csv`
const rows = ["url,bytes,sha256,moved_to"]
let movedBytes = 0
mkdirSync(dirname(manifestPath), { recursive: true })

for (const file of unused) {
  const relativePath = relative(PRODUCT_IMAGE_ROOT, file.file)
  const target = join(destinationRoot, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  const sha256 = createHash("sha256").update(readFileSync(file.file)).digest("hex")
  renameSync(file.file, target)
  movedBytes += file.size
  rows.push(`${file.url},${file.size},${sha256},${target}`)
}

writeFileSync(manifestPath, rows.join("\n") + "\n")
console.log(`\n已移动 ${unused.length} 个文件，${megabytes(movedBytes)} MB → ${destinationRoot}/`)
console.log(`清单已写入 ${manifestPath}`)
