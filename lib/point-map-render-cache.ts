import { normalizeDesignPlan } from "./point-map-design"
import type { PointMapPlan } from "./point-map-plan"
import type { PointMapRenderGeometry, PointMapRenderProduct } from "./point-map-render"

/** Bump whenever photo processing, marker layout or drawing semantics change. */
export const POINT_MAP_RENDER_VERSION = "image-size-3000-2026-10-15-v4"
export type CachedPointMapFloor = { blob?: Blob; dataUrl?: string; markerGeometry?: PointMapRenderGeometry }
export type PointMapFloorRenderCache = {
  get(key: string): Promise<CachedPointMapFloor | undefined>
  put(key: string, value: CachedPointMapFloor): Promise<void>
}

/** Only pixels visible on this floor participate; pricing and scene prose do not. */
export async function pointMapFloorRenderKey(input: PointMapPlan, floorId: string, products: readonly PointMapRenderProduct[], productIdByPointId: ReadonlyMap<string, string>, namespace = "live") {
  const plan = normalizeDesignPlan(input)
  const floor = plan.floors?.find((item) => item.id === floorId)
  if (!floor) throw new Error("未找到需要出图的楼层。")
  const points = plan.points.filter((point) => point.floorId === floorId && point.placed).map((point) => ({
    id: point.id, code: point.code, name: point.name, iconId: point.iconId, x: point.x, y: point.y, status: point.status,
    deviceTypeId: point.deviceTypeId, requirements: point.requirements,
    display: point.display, productId: productIdByPointId.get(point.id) || point.productId,
  }))
  const used = new Set(points.map((point) => point.productId).filter(Boolean))
  const photos = products.filter((product) => used.has(product.id)).map((product) => ({
    id: product.id, image: product.image ?? null, crop: product.visualAsset?.crop ?? null, scale: product.visualAsset?.scale ?? 1,
    revision: product.visualAsset?.revision ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id))
  const fingerprint = JSON.stringify({ version: POINT_MAP_RENDER_VERSION, projectId: plan.projectId, namespace, floor: { id: floor.id, image: floor.floorplanDataUrl, imageWidth: floor.imageWidth, imageHeight: floor.imageHeight, presentation: floor.presentation }, points, photos })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
  return `${plan.projectId}:${namespace}:${floor.id}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

type Entry = CachedPointMapFloor & { key: string; bytes: number; touched: number }
const size = (value: CachedPointMapFloor) => value.blob?.size ?? (value.dataUrl?.length ?? 0) * 2

/** Small LRU used by browsers without IndexedDB and injected by regression tests. */
export function createMemoryPointMapFloorRenderCache(maxEntries = 4, maxBytes = 32 * 1024 * 1024): PointMapFloorRenderCache {
  const entries = new Map<string, Entry>()
  return {
    async get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key); entries.set(key, entry)
      return entry
    },
    async put(key, value) {
      const bytes = size(value)
      entries.delete(key)
      if (bytes > maxBytes) return
      entries.set(key, { ...value, key, bytes, touched: Date.now() })
      while (entries.size > maxEntries || [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) > maxBytes) entries.delete(entries.keys().next().value!)
    },
  }
}

const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result)
  operation.onerror = () => reject(operation.error)
})
const complete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = () => reject(transaction.error)
  transaction.onerror = () => reject(transaction.error)
})

/** 24 PNGs / 128 MiB on disk, 4 PNGs / 32 MiB in memory; storage errors never block export. */
export function createBrowserPointMapFloorRenderCache(): PointMapFloorRenderCache {
  const memory = createMemoryPointMapFloorRenderCache()
  let unavailable = false
  let database: Promise<IDBDatabase> | undefined
  let writes = Promise.resolve()
  function open() {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"))
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("fmkj-point-map-renders", 1)
      opening.onupgradeneeded = () => opening.result.createObjectStore("floors", { keyPath: "key" })
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
      opening.onblocked = () => reject(new Error("Point map cache is blocked"))
    })
    return database
  }
  return {
    async get(key) {
      const cached = await memory.get(key)
      if (cached || unavailable) return cached
      try {
        const db = await open()
        const entry = await request(db.transaction("floors", "readonly").objectStore("floors").get(key)) as Entry | undefined
        if (entry) {
          await memory.put(key, entry)
          const transaction = db.transaction("floors", "readwrite")
          const done = complete(transaction)
          transaction.objectStore("floors").put({ ...entry, touched: Date.now() })
          await done
        }
        return entry
      } catch { unavailable = true; return undefined }
    },
    async put(key, value) {
      await memory.put(key, value)
      if (unavailable || size(value) > 128 * 1024 * 1024) return
      writes = writes.then(async () => {
        try {
          const db = await open()
          const current = await request(db.transaction("floors", "readonly").objectStore("floors").getAll()) as Entry[]
          const entry: Entry = { ...value, key, touched: Date.now(), bytes: size(value) }
          const ordered = [...current.filter((item) => item.key !== key), entry].sort((a, b) => b.touched - a.touched)
          let bytes = 0
          const keep = new Set(ordered.filter((item, index) => { bytes += item.bytes; return index < 24 && bytes <= 128 * 1024 * 1024 }).map((item) => item.key))
          const transaction = db.transaction("floors", "readwrite")
          const done = complete(transaction)
          const store = transaction.objectStore("floors")
          store.put(entry)
          for (const item of ordered) if (!keep.has(item.key)) store.delete(item.key)
          await done
        } catch { unavailable = true }
      })
      await writes
    },
  }
}

let sharedCache: PointMapFloorRenderCache | undefined
export function defaultPointMapFloorRenderCache() {
  return sharedCache ??= createBrowserPointMapFloorRenderCache()
}
