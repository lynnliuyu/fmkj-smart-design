/**
 * Shrinks oversized product images in place without touching their paths, so no
 * database row has to change. PNG is capped at 1200px and JPEG at 1600px on the
 * long side (JPEG re-encoded at quality 85); a file is only replaced when the
 * result is at least 5% smaller, which is why nothing ever grows.
 *
 * Usage: pnpm products:optimize            (dry run, prints what would change)
 *        node scripts/optimize-product-images.mjs --apply
 * Requires macOS `sips`.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join, relative } from "node:path"

const APPLY = process.argv.includes("--apply")
const ROOT = "public/assets/products"
const TMP = "/tmp/imgopt"
const PNG_MAX = 1200
const JPEG_MAX = 1600
const JPEG_QUALITY = 85

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile()) files.push(full)
  }
}
walk(ROOT)
mkdirSync(TMP, { recursive: true })

function dimensions(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" })
  return {
    width: Number(out.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0),
    height: Number(out.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0),
  }
}

let before = 0
let after = 0
let replaced = 0
let skipped = 0
const report = []

for (const file of files) {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase()
  if (![".png", ".jpg", ".jpeg"].includes(ext)) continue
  const size = statSync(file).size
  const { width, height } = dimensions(file)
  const max = Math.max(width, height)
  const limit = ext === ".png" ? PNG_MAX : JPEG_MAX
  if (max <= limit) continue

  before += size
  const tmp = join(TMP, relative(ROOT, file).replace(/\//g, "_"))
  const args = ["-Z", String(limit), file, "--out", tmp]
  if (ext !== ".png") args.push("-s", "formatOptions", String(JPEG_QUALITY))
  try {
    execFileSync("sips", args, { stdio: "ignore" })
  } catch (error) {
    skipped += 1
    after += size
    continue
  }

  const nextSize = statSync(tmp).size
  if (nextSize >= size * 0.95) {
    skipped += 1
    after += size
    unlinkSync(tmp)
    continue
  }

  after += nextSize
  replaced += 1
  report.push(`  ${width}x${height} ${Math.round(size / 1024)}KB -> ${Math.round(nextSize / 1024)}KB  ${relative(ROOT, file)}`)
  if (APPLY) copyFileSync(tmp, file)
  unlinkSync(tmp)
}

console.log(`${APPLY ? "执行" : "预演"}：${report.length} 个需要缩小`)
for (const line of report) console.log(line)
console.log(`合计 ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB（替换 ${replaced}，跳过 ${skipped}）`)
