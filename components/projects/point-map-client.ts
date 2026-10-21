import type { PointMapPlan } from "@/lib/point-map-plan";

export type PointMapResponse = {
  data: PointMapPlan | null;
  revision: number;
};

export class PointMapRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    /** 服务端返回的机器可读原因与当前云端版本，用于区分「他人改过」和普通校验失败。 */
    public details: { code?: string; revision?: number } = {},
  ) {
    super(message);
    this.name = "PointMapRequestError";
  }

  get code() {
    return this.details.code;
  }

  get revision() {
    return this.details.revision;
  }
}

export async function fetchProjectPointMap(projectId: string) {
  return requestPointMap(
    `/api/projects/${encodeURIComponent(projectId)}/point-map`,
  );
}

export async function saveProjectPointMap(
  plan: PointMapPlan,
  expectedRevision: number,
) {
  return requestPointMap(
    `/api/projects/${encodeURIComponent(plan.projectId)}/point-map`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, expectedRevision }),
    },
  );
}

/** 服务端错误码到可执行说明的映射；具体原因比 HTTP 状态更能解释「为什么保存失败」。 */
const failureMessages: Record<string, string> = {
  POINT_MAP_REVISION_LIMIT:
    "该项目的点位版本号已达上限，无法继续保存。请新建项目或联系管理员；本机草稿仍然保留。",
  PROJECT_READ_ONLY:
    "当前账号对该项目只有查看权限，无法保存点位草稿。本机草稿仍然保留，请项目管理员调整权限后重试。",
  ACCOUNT_DISABLED: "账号已停用，无法保存。请联系管理员恢复；本机草稿仍然保留。",
  RESOURCE_NOT_FOUND_OR_NOT_OWNED:
    "项目不存在或不在当前账号的可见范围内（可能已删除或被移出团队）。本机草稿仍然保留。",
  POINT_MAP_TOO_LARGE:
    "草稿体积超过 32 MB，保存失败。请缩小或减少底图后重试；本地草稿仍然保留。",
  JSON_CONTENT_TYPE_REQUIRED:
    "保存请求格式不正确，请刷新页面后重试。当前草稿仍保留在本机。",
};

async function requestPointMap(
  url: string,
  init?: RequestInit,
): Promise<PointMapResponse> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<PointMapResponse> & {
        error?: string;
        message?: string;
        code?: string;
      })
    | null;
  if (!response.ok) {
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    const revision = Number.isSafeInteger(payload?.revision)
      ? payload?.revision
      : undefined;
    const serverMessage =
      payload?.message ||
      (payload?.error && !/^[A-Z0-9_]+$/.test(payload.error)
        ? payload.error
        : "");
    const message =
      code === "POINT_MAP_REVISION_LIMIT"
        ? failureMessages[code]
        : response.status === 409
          ? `云端已有更新${
              revision === undefined ? "" : `（云端 r${revision}）`
            }，本次没有覆盖；本机草稿仍然保留。请先导出本地 JSON，再加载云端版本比较。`
          : response.status === 401
            ? "登录已失效，请重新登录后保存。当前草稿仍保留在本机。"
            : response.status === 403
              ? failureMessages[code ?? ""] ||
                "当前账号没有该项目点位图的编辑权限。本机草稿仍然保留。"
              : response.status === 404
                ? failureMessages.RESOURCE_NOT_FOUND_OR_NOT_OWNED
                : response.status === 413
                  ? failureMessages.POINT_MAP_TOO_LARGE
                  : response.status === 415
                    ? failureMessages.JSON_CONTENT_TYPE_REQUIRED
                    : serverMessage ||
                      failureMessages[code ?? ""] ||
                      "云端暂时不可用，草稿仅保存在本机。";
    throw new PointMapRequestError(response.status, message, {
      code,
      revision,
    });
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
  };
}
