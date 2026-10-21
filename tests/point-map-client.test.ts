import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PointMapRequestError,
  saveProjectPointMap,
} from "../components/projects/point-map-client";
import { emptyPointMapPlan } from "../lib/point-map-plan";

afterEach(() => vi.unstubAllGlobals());

describe("point-map client failures", () => {
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

  it("keeps the cloud revision and reason of a conflict so the editor can explain it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "POINT_MAP_REVISION_CONFLICT",
            error: "POINT_MAP_REVISION_CONFLICT",
            revision: 7,
          }),
          { status: 409 },
        ),
      ),
    );
    const error = await saveProjectPointMap(
      emptyPointMapPlan("project-a"),
      3,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PointMapRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: "POINT_MAP_REVISION_CONFLICT",
      revision: 7,
    });
    expect((error as Error).message).toContain("r7");
    expect((error as Error).message).toContain("本机草稿仍然保留");
  });

  it("tells the user that a rejected save keeps the local draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "POINT_MAP_UNAVAILABLE" }), {
          status: 503,
        }),
      ),
    );
    const error = await saveProjectPointMap(
      emptyPointMapPlan("project-a"),
      1,
    ).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe("云端暂时不可用，草稿仅保存在本机。");
  });

  it.each([
    [
      404,
      { error: "RESOURCE_NOT_FOUND_OR_NOT_OWNED" },
      "项目不存在或不在当前账号的可见范围内（可能已删除或被移出团队）。本机草稿仍然保留。",
    ],
    [
      403,
      { code: "PROJECT_READ_ONLY", error: "PROJECT_READ_ONLY" },
      "当前账号对该项目只有查看权限，无法保存点位草稿。本机草稿仍然保留，请项目管理员调整权限后重试。",
    ],
    [
      409,
      { code: "POINT_MAP_REVISION_LIMIT", error: "POINT_MAP_REVISION_LIMIT" },
      "该项目的点位版本号已达上限，无法继续保存。请新建项目或联系管理员；本机草稿仍然保留。",
    ],
    [
      413,
      { code: "POINT_MAP_TOO_LARGE", error: "POINT_MAP_TOO_LARGE" },
      "草稿体积超过 32 MB，保存失败。请缩小或减少底图后重试；本地草稿仍然保留。",
    ],
  ])(
    "explains the failure reason behind status %i instead of blaming the network",
    async (status, body, expected) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify(body), { status })),
      );
      const error = await saveProjectPointMap(
        emptyPointMapPlan("project-a"),
        1,
      ).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PointMapRequestError);
      expect((error as Error).message).toBe(expected);
    },
  );

  it("still reports the cloud revision for a real revision conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "POINT_MAP_REVISION_CONFLICT",
            error: "POINT_MAP_REVISION_CONFLICT",
            revision: 4,
          }),
          { status: 409 },
        ),
      ),
    );
    const error = await saveProjectPointMap(
      emptyPointMapPlan("project-a"),
      1,
    ).catch((reason: unknown) => reason);
    expect((error as Error).message).toContain("云端已有更新（云端 r4）");
  });
});
