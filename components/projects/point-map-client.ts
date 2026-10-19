import type { PointMapPlan } from "@/lib/point-map-plan";

export type PointMapVersion = { revision: number; confirmedAt: string };
export type PointMapResponse = {
  data: PointMapPlan | null;
  revision: number;
  versions: PointMapVersion[];
};

export class PointMapRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PointMapRequestError";
  }
}

export async function fetchProjectPointMap(
  projectId: string,
  version?: number,
) {
  const query = version === undefined ? "" : `?version=${version}`;
  return requestPointMap(
    `/api/projects/${encodeURIComponent(projectId)}/point-map${query}`,
  );
}

export async function saveProjectPointMap(
  plan: PointMapPlan,
  expectedRevision: number,
  confirm = false,
) {
  return requestPointMap(
    `/api/projects/${encodeURIComponent(plan.projectId)}/point-map`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, expectedRevision, confirm }),
    },
  );
}

async function requestPointMap(
  url: string,
  init?: RequestInit,
): Promise<PointMapResponse> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<PointMapResponse> & { error?: string; message?: string })
    | null;
  if (!response.ok) {
    const serverMessage =
      payload?.message ||
      (payload?.error && !/^[A-Z0-9_]+$/.test(payload.error)
        ? payload.error
        : "");
    const message =
      response.status === 409
        ? "云端已有更新，本次没有覆盖。请先导出本地 JSON，再加载云端版本比较。"
        : response.status === 401
          ? "登录已失效，请重新登录后保存。当前草稿仍保留在本机。"
          : response.status === 403
            ? "当前账号没有该项目点位图的编辑权限。"
            : response.status === 413
              ? "底图过大，保存失败。请缩小图片后重试；本地草稿仍然保留。"
              : serverMessage || "云端暂时不可用，草稿仅保存在本机。";
    throw new PointMapRequestError(response.status, message);
  }
  if (!payload || !Number.isInteger(payload.revision) || !("data" in payload)) {
    throw new PointMapRequestError(
      502,
      "云端返回的数据无效，当前草稿仍保留在本机。",
    );
  }
  return {
    data: payload.data ?? null,
    revision: payload.revision!,
    versions: payload.versions ?? [],
  };
}
