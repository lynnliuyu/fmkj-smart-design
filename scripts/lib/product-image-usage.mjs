/**
 * Shared usage analysis for product images.
 *
 * "Used" means referenced by products.image, product_visual_assets, or embedded in a
 * stored quote / delivery snapshot. Those snapshots are why an image that no current
 * product points at can still be needed: history keeps its own copy of the path.
 *
 * Read only. Both `audit-product-images` and `prune-unused-product-images` build on it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { Client } from "pg"

export const PRODUCT_IMAGE_ROOT = "public/assets/products"
const URL_PATTERN = /\/assets\/products\/[^"'\\\s,)]+/g

export function databaseUrl() {
  const env = readFileSync(".env.local", "utf8")
  const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, "")
  if (!url) throw new Error("DATABASE_URL is missing from .env.local")
  return url
}

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.isFile()) files.push(full)
  }
  return files
}

export function diskProductImages(root = PRODUCT_IMAGE_ROOT) {
  return walk(root, []).map((file) => ({
    file,
    url: "/" + relative("public", file).replace(/\\/g, "/"),
    size: statSync(file).size,
  }))
}

/** url -> Set of sources that mention it */
export async function referencedProductImages() {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  const referenced = new Map()
  const add = (value, source) => {
    if (!value || typeof value !== "string") return
    for (const match of value.matchAll(URL_PATTERN)) {
      const path = match[0].split("?")[0]
      if (!referenced.has(path)) referenced.set(path, new Set())
      referenced.get(path).add(source)
    }
  }
  try {
    for (const row of (await client.query(`select image from products where image is not null and image <> ''`)).rows) add(row.image, "products.image")
    for (const row of (await client.query(`select image, source_image from product_visual_assets`)).rows) {
      add(row.image, "visual.image")
      add(row.source_image, "visual.source")
    }
    for (const row of (await client.query(`select product_snapshot::text t from quote_items where product_snapshot is not null`)).rows) add(row.t, "quote_snapshot")
    for (const row of (await client.query(`select snapshot::text t from project_deliveries where snapshot is not null`)).rows) add(row.t, "delivery_snapshot")
  } finally {
    await client.end()
  }
  return referenced
}

export async function analyseProductImages() {
  const files = diskProductImages()
  const referenced = await referencedProductImages()
  const filesByUrl = new Set(files.map((file) => file.url))
  const unused = files.filter((file) => !referenced.has(file.url))
  const dangling = [...referenced.keys()].filter((url) => !filesByUrl.has(url))
  return {
    files,
    referenced,
    unused,
    dangling,
    unusedBytes: unused.reduce((total, file) => total + file.size, 0),
  }
}

export const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(2)
