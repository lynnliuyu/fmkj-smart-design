import { describe, expect, it } from "vitest";
import { parseReferencePreparationArgs, referencePreparationViews } from "../scripts/prepare-cad-reference-drawings.mjs";

const sheet = (id: string) => ({ id, viewports: [{ modelEntityCount: 10, window: [[0, 0], [100, 80]], frozenLayers: ["hidden"] }] });
const manifest = { format: "fmkj-cad-review", sourceSha256: "source-hash", sheets: [sheet("lighting"), sheet("switch")] };
describe("preparing common-coordinate CAD references", () => {
  it("requires explicit reviewed sheets and preserves their distinct visibility", () => {
    const views = referencePreparationViews(manifest, "source-hash", [10, 10, 90, 70], "lighting", "switch");
    expect(views.map((view: { kind: string }) => view.kind)).toEqual(["lighting", "switch"]);
    expect(views[0].viewport.frozenLayers).toEqual(["hidden"]);
    expect(() => referencePreparationViews(manifest, "another-file", [10, 10, 90, 70], "lighting", "switch")).toThrow(/指纹不符/);
    expect(() => referencePreparationViews(manifest, "source-hash", [-1, 10, 90, 70], "lighting", "switch")).toThrow(/共同坐标/);
    expect(() => referencePreparationViews(manifest, "source-hash", [10, 10, 90, 70], "missing", "switch")).toThrow(/可用的单视口/);
  });
  it("rejects incomplete or injected CLI flags before opening a drawing", () => {
    expect(() => parseReferencePreparationArgs(["--source", "a.dwg"])).toThrow();
    expect(() => parseReferencePreparationArgs(["--execute", "erase"])).toThrow();
    const args = ["--source", "original.dwg", "--plan", "p.json", "--review-manifest", "manifest.json", "--floor-id", "one", "--lighting-page", "page-1", "--switch-page", "page-2", "--out-dir", "new"];
    expect(parseReferencePreparationArgs(args)).toMatchObject({ "--floor-id": "one" });
    expect(() => parseReferencePreparationArgs([...args, "--source", "other.dwg"])).toThrow();
  });
});
