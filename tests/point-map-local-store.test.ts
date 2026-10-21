import { describe, expect, it } from "vitest";
import { createPointMapLocalStore, type LocalPlanRecord, type LocalPlanRepository } from "../lib/point-map-local-store";
import { normalizeDesignPlan } from "../lib/point-map-design";
import { emptyPointMapPlan } from "../lib/point-map-plan";
import { fingerprintFloorplan } from "../lib/point-map-presentation";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function repository() {
  const records = new Map<string, LocalPlanRecord>();
  const assets = new Map<string, Parameters<LocalPlanRepository["write"]>[1][number]>();
  let fail = false;
  return { records, assets, fail(value: boolean) { fail = value; },
    async read(key: string) { const record = records.get(key); return record ? { record, assets: record.images.flatMap((id) => assets.has(id) ? [assets.get(id)!] : []) } : undefined; },
    async write(record: LocalPlanRecord, images: Parameters<LocalPlanRepository["write"]>[1]) {
      if (fail) throw new Error("QuotaExceededError");
      images.forEach((asset) => assets.set(asset.key, asset)); records.set(record.key, structuredClone(record));
    },
  };
}
const plan = () => normalizeDesignPlan({ ...emptyPointMapPlan("one"), floorplanDataUrl: image, floorplanName: "净底.png" });

describe("durable local drafts with deduplicated image assets", () => {
  it("keeps repeated picture bytes out of metadata, shares images with backups and restores exact fingerprints", async () => {
    const repo = repository(), store = createPointMapLocalStore(repo);
    const input = plan();
    input.floors![0].presentation = { name: "展示", imageDataUrl: image, imageWidth: 1, imageHeight: 1, sourceFingerprint: await fingerprintFloorplan(image), matrix: [1, 0, 0, 1, 0, 0], anchors: [] };
    await store.write(input);
    await store.write(input, true);
    expect(repo.assets.size).toBe(1);
    expect(repo.records.size).toBe(2);
    expect(JSON.stringify([...repo.records.values()])).not.toContain("base64,");
    expect((await store.read("one"))?.plan).toEqual(input);
    expect((await store.read("one", true))?.plan).toEqual(input);
    expect(await fingerprintFloorplan((await store.read("one"))!.plan.floorplanDataUrl)).toBe(await fingerprintFloorplan(image));
  });

  it("migrates a legacy draft only after committing its image and metadata", async () => {
    const repo = repository(), values = new Map([["fmkj:point-map:one", JSON.stringify(plan())]]);
    const legacy = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
    const store = createPointMapLocalStore(repo, legacy);
    repo.fail(true);
    expect((await store.read("one"))?.durable).toBe(false);
    expect(values.has("fmkj:point-map:one")).toBe(true);
    repo.fail(false);
    expect((await store.read("one"))?.durable).toBe(true);
    expect(values.size).toBe(0);
    expect(repo.assets.size).toBe(1);
  });

  it("preserves the previous good draft on failed writes and orders rapid edits", async () => {
    const repo = repository(), store = createPointMapLocalStore(repo);
    const first = plan(); await store.write(first);
    repo.fail(true);
    await expect(store.write({ ...first, floorplanName: "failed" })).rejects.toThrow("QuotaExceededError");
    expect((await store.read("one"))!.plan.floorplanName).toBe(first.floorplanName);
    repo.fail(false);
    const earlier = structuredClone(first), later = structuredClone(first);
    earlier.floors![0].name = "earlier"; later.floors![0].name = "latest";
    await Promise.all([store.write(earlier), store.write(later)]);
    expect((await store.read("one"))!.plan.floors![0].name).toBe("latest");
    expect(await store.read("other-project")).toBeNull();
  });

  it("rejects missing images and unknown record versions without returning a partial plan", async () => {
    const repo = repository(), store = createPointMapLocalStore(repo);
    await store.write(plan());
    const images = new Map(repo.assets); repo.assets.clear();
    await expect(store.read("one")).rejects.toThrow(/图片缺失/);
    images.forEach((asset, key) => repo.assets.set(key, asset));
    (repo.records.get("fmkj:point-map:one") as unknown as { version: number }).version = 2;
    await expect(store.read("one")).rejects.toThrow(/版本或项目不符/);
  });

  it("re-encodes the floorplan only once across repeated edits", async () => {
    const repo = repository(), store = createPointMapLocalStore(repo);
    const blobs: Blob[] = [];
    const persist = repo.write.bind(repo);
    repo.write = async (record, assets) => {
      for (const asset of assets) blobs.push(asset.blob);
      return persist(record, assets);
    };
    const base = plan();
    await store.write(base);
    await store.write({ ...base, floorplanName: "second" });
    await store.write({ ...base, floorplanName: "third" });
    expect(blobs).toHaveLength(3);
    // 同一张底图复用同一份打包结果，而不是每次编辑都重新 base64 解码 + 编码 + 哈希。
    expect(blobs[1]).toBe(blobs[0]);
    expect(blobs[2]).toBe(blobs[1]);
  });

  it("coalesces superseded writes so rapid edits cost one durable write", async () => {
    const repo = repository(), store = createPointMapLocalStore(repo);
    let durableWrites = 0;
    const persist = repo.write.bind(repo);
    repo.write = async (record, assets) => {
      durableWrites += 1;
      return persist(record, assets);
    };
    const base = plan();
    const edits = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      floors: base.floors!.map((floor) => ({ ...floor, name: `edit-${index}` })),
    }));
    await Promise.all(edits.map((value) => store.write(value)));
    expect(durableWrites).toBe(1);
    expect((await store.read("one"))!.plan.floors![0].name).toBe("edit-19");
  });
});
