import { normalizeDesignPlan } from "./point-map-design";
import { readPointMapPlan, type PointMapPlan } from "./point-map-plan";

type ImageReference = { $image: string };
type ImageAsset = { key: string; blob: Blob; prefix: string; literal: boolean };
export type LocalPlanRecord = { key: string; format: "fmkj-local-point-map"; version: 1; projectId: string; plan: unknown; images: string[] };
export type LocalPlanRepository = {
  read(key: string): Promise<{ record: LocalPlanRecord; assets: ImageAsset[] } | undefined>;
  write(record: LocalPlanRecord, assets: ImageAsset[]): Promise<void>;
};
type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;
const imageFields = new Set(["floorplanDataUrl", "imageDataUrl"]);
const keyFor = (projectId: string, backup: boolean) => `fmkj:point-map:${backup ? "backup:" : ""}${projectId}`;

async function hash(source: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
async function packImage(source: string, knownKey?: string): Promise<ImageAsset> {
  const key = knownKey ?? (await hash(source));
  const match = /^(data:image\/[^;,]+;base64,)([\s\S]+)$/.exec(source);
  if (match) {
    try {
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      // Preserve the exact source string: presentation fingerprints depend on it.
      if (base64(bytes) === match[2]) return { key, blob: new Blob([bytes]), prefix: match[1], literal: false };
    } catch { /* Noncanonical legacy strings are retained verbatim. */ }
  }
  return { key, blob: new Blob([source]), prefix: "", literal: true };
}
async function mapImages(value: unknown, convert: (value: string) => Promise<unknown>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapImages(item, convert)));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key,
    imageFields.has(key) && typeof entry === "string" && entry.startsWith("data:image/") ? await convert(entry) : await mapImages(entry, convert),
  ])));
}
function restoreImages(value: unknown, assets: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => restoreImages(entry, assets));
  if (!value || typeof value !== "object") return value;
  const reference = value as ImageReference;
  if (Object.keys(value).length === 1 && typeof reference.$image === "string") {
    const source = assets.get(reference.$image);
    if (!source) throw new Error("本机草稿的图片缺失，已保留记录；请恢复备份或加载数据库草稿。");
    return source;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restoreImages(entry, assets)]));
}

/** 底图 base64 的 atob/重编码比哈希贵得多，同一张图在多轮编辑里复用结果。 */
const MAX_PACKED_IMAGES = 6;

/** Image bytes and a compact plan commit together. Failure never replaces the last good draft. */
export function createPointMapLocalStore(repository: LocalPlanRepository, legacy?: LegacyStorage) {
  const pending = new Map<string, Promise<void>>();
  const latestWrite = new Map<string, number>();
  const packed = new Map<string, ImageAsset>();
  let writeSequence = 0;

  async function packCached(source: string): Promise<ImageAsset> {
    const key = await hash(source);
    const cached = packed.get(key);
    if (cached) {
      // 命中后移到队尾，让淘汰按最近使用而不是插入顺序。
      packed.delete(key);
      packed.set(key, cached);
      return cached;
    }
    const asset = await packImage(source, key);
    packed.set(key, asset);
    if (packed.size > MAX_PACKED_IMAGES) {
      const oldest = packed.keys().next().value;
      if (oldest !== undefined) packed.delete(oldest);
    }
    return asset;
  }

  function write(plan: PointMapPlan, backup = false): Promise<void> {
    const snapshot = structuredClone(plan);
    const key = keyFor(plan.projectId, backup);
    const previousLegacy = legacy?.getItem(key);
    const sequence = ++writeSequence;
    latestWrite.set(key, sequence);
    const work = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      // 已经有更新的写入排队时，这一笔会被后一笔完全覆盖：直接跳过，
      // 避免拖动/连打时每一下都做一次完整的图片打包与 IndexedDB 事务。
      if (latestWrite.get(key) !== sequence) return;
      const assets = new Map<string, Promise<ImageAsset>>();
      const compact = await mapImages(snapshot, async (source) => {
        let asset = assets.get(source);
        if (!asset) { asset = packCached(source); assets.set(source, asset); }
        return { $image: (await asset).key };
      });
      const resolved = await Promise.all(assets.values());
      await repository.write({ key, projectId: plan.projectId, format: "fmkj-local-point-map", version: 1, plan: compact, images: resolved.map((asset) => asset.key) }, resolved);
      // Do not erase a legacy write made by another tab during migration.
      try { if (previousLegacy && legacy?.getItem(key) === previousLegacy) legacy.removeItem(key); } catch { /* The committed draft is durable; cleanup can be retried. */ }
    });
    pending.set(key, work);
    void work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(() => {});
    return work;
  }
  async function read(projectId: string, backup = false): Promise<{ plan: PointMapPlan; durable: boolean } | null> {
    const key = keyFor(projectId, backup);
    // A failed write must not turn into an empty draft or discard the previous one.
    await pending.get(key)?.catch(() => {});
    let stored: Awaited<ReturnType<LocalPlanRepository["read"]>>;
    let readError: unknown;
    try { stored = await repository.read(key); } catch (error) { readError = error; }
    if (stored) {
      const { record, assets } = stored;
      if (record.format !== "fmkj-local-point-map" || record.version !== 1 || record.projectId !== projectId) throw new Error("本机草稿版本或项目不符，原缓存已保留。");
      const sources = new Map<string, string>();
      for (const asset of assets) {
        const source = asset.literal ? await asset.blob.text() : asset.prefix + base64(new Uint8Array(await asset.blob.arrayBuffer()));
        if (await hash(source) !== asset.key) throw new Error("本机图片校验失败，原缓存已保留。");
        sources.set(asset.key, source);
      }
      const plan = restoreImages(record.plan, sources) as PointMapPlan;
      if (plan.projectId !== projectId) throw new Error("本机草稿不属于当前项目。");
      return { plan: normalizeDesignPlan(plan), durable: true };
    }
    const raw = legacy?.getItem(key);
    if (!raw) { if (readError) throw readError; return null; }
    const parsed = JSON.parse(raw) as PointMapPlan;
    if (parsed.projectId !== projectId) throw new Error("旧缓存不属于当前项目，已保留。");
    const restored = backup ? normalizeDesignPlan(parsed) : normalizeDesignPlan(readPointMapPlan(projectId, { getItem: () => raw, setItem() {} }));
    // Migration is best effort: readable old data remains usable if disk is unavailable.
    let durable = true;
    await write(restored, backup).catch(() => { durable = false; });
    return { plan: restored, durable };
  }
  return { read, write };
}

const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error ?? new Error("本机图片存储失败"));
});
const complete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("本机保存已中止"));
  transaction.onerror = () => reject(transaction.error ?? new Error("本机保存失败"));
});

/** 浏览器只在英文 DOMException 里给出配额原因，转成可执行的提示而不是抛出原始文本。 */
function readableStorageError(error: unknown): Error {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const code = error && typeof error === "object" && "code" in error ? Number((error as { code: unknown }).code) : 0;
  if (name === "QuotaExceededError" || name === "QuotaExceeded" || code === 22)
    return new Error("本机存储空间不足，底图没有写进本机缓存。请保存到数据库或导出 JSON，并清理浏览器站点数据后重试。");
  return error instanceof Error ? error : new Error("本机保存失败，请保存到数据库或导出 JSON。");
}

/** Durable drafts are separate from evictable render caches; no LRU removes source images. */
export function createBrowserPointMapLocalRepository(): LocalPlanRepository {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("浏览器不支持本机图片存储，请保存数据库或导出 JSON。"));
    database ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open("fmkj-point-map-drafts", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("plans", { keyPath: "key" });
        opening.result.createObjectStore("images", { keyPath: "key" });
      };
      opening.onsuccess = () => {
        opening.result.onversionchange = () => { opening.result.close(); database = undefined; };
        resolve(opening.result);
      };
      opening.onerror = () => { database = undefined; reject(opening.error); };
      opening.onblocked = () => { database = undefined; reject(new Error("本机缓存升级被其他页面占用，请关闭旧工作台后重试。")); };
    });
    return database;
  }
  return {
    async read(key) {
      const db = await open();
      const transaction = db.transaction(["plans", "images"], "readonly");
      const done = complete(transaction);
      // Consume errors even if an individual request rejects first.
      void done.catch(() => {});
      const record = await request(transaction.objectStore("plans").get(key)) as LocalPlanRecord | undefined;
      if (!record) { await done; return undefined; }
      const images = transaction.objectStore("images");
      const assets = await Promise.all(record.images.map((id) => request(images.get(id)))) as Array<ImageAsset | undefined>;
      await done;
      return { record, assets: assets.filter((asset): asset is ImageAsset => Boolean(asset)) };
    },
    async write(record, assets) {
      const db = await open();
      const transaction = db.transaction(["plans", "images"], "readwrite");
      const done = complete(transaction);
      for (const asset of assets) transaction.objectStore("images").put(asset);
      transaction.objectStore("plans").put(record);
      try { await done; } catch (error) { throw readableStorageError(error); }
    },
  };
}

let shared: ReturnType<typeof createPointMapLocalStore> | undefined;
export function pointMapLocalStore() {
  let legacy: LegacyStorage | undefined;
  try { legacy = typeof window === "undefined" ? undefined : window.localStorage; } catch { /* IndexedDB can still be usable. */ }
  return shared ??= createPointMapLocalStore(createBrowserPointMapLocalRepository(), legacy);
}
