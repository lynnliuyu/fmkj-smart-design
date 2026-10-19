import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PointMapRequestError,
  saveProjectPointMap,
} from "../components/projects/point-map-client";
import { emptyPointMapPlan } from "../lib/point-map-plan";

afterEach(() => vi.unstubAllGlobals());

describe("point-map client failures", () => {
  it("shows the service validation message instead of claiming the connection is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "POINT_MAP_REVIEW_REQUIRED",
            error: "场景缺少触发方式，无法确认版本。",
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(
      saveProjectPointMap(emptyPointMapPlan("project-a"), 1, true),
    ).rejects.toMatchObject({
      status: 400,
      message: "场景缺少触发方式，无法确认版本。",
    });
  });

  it("does not automatically retry a stale write with a newer revision", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "版本已变更", revision: 2 }), {
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveProjectPointMap(emptyPointMapPlan("project-a"), 1),
    ).rejects.toBeInstanceOf(PointMapRequestError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).expectedRevision).toBe(1);
  });
});
