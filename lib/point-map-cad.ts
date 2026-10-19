import { normalizeDesignPlan, validateDesignPlan } from "./point-map-design";
import type { PointMapPlan } from "./point-map-plan";
import {
  cadToPercent,
  parseCadExchange,
  parseCadReturn,
  type CadExchange,
  type CadReturn,
} from "./point-map-cad-contract";

export type CadReturnPreview = {
  payload: CadReturn;
  changes: {
    id: string;
    code: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[];
  unchanged: number;
};

export async function createCadExchange(
  plan: PointMapPlan,
  floorId: string,
): Promise<CadExchange> {
  const current = validateDesignPlan(plan);
  const floor = current.floors!.find((item) => item.id === floorId);
  if (!floor?.cad)
    throw new Error(
      "当前楼层尚未绑定 CAD 净底与坐标窗口，请先导入已配准的净底草稿。",
    );
  const points = current.points.filter(
    (point) => point.floorId === floorId && point.placed,
  );
  if (!points.length) throw new Error("当前楼层没有已定位点位。");
  return parseCadExchange({
    format: "fmkj-cadcraft-exchange",
    version: 1,
    exchangeId: crypto.randomUUID(),
    projectId: current.projectId,
    floorId,
    floorName: floor.name,
    drawing: floor.cad,
    backgroundSha256: await backgroundSha256(floor.floorplanDataUrl),
    points: points.map((point) => ({
      id: point.id,
      code: point.code!,
      iconId: point.iconId,
      x: point.x,
      y: point.y,
    })),
  });
}

/** Preview and apply share the same checks. Re-run against the latest plan before applying. */
export async function previewCadReturn(
  plan: PointMapPlan,
  value: unknown,
): Promise<CadReturnPreview> {
  const payload = parseCadReturn(value);
  const current = validateDesignPlan(plan);
  const exchange = payload.exchange;
  if (exchange.projectId !== current.projectId)
    throw new Error("CAD 回传文件不属于当前项目。");
  const floor = current.floors!.find((item) => item.id === exchange.floorId);
  if (
    !floor?.cad ||
    JSON.stringify(floor.cad) !== JSON.stringify(exchange.drawing)
  )
    throw new Error("CAD 回传底图或坐标绑定已变化，请重新导出当前楼层。");
  if (
    (await backgroundSha256(floor.floorplanDataUrl)) !==
    exchange.backgroundSha256
  )
    throw new Error("CAD 回传背景与当前底图不一致，请重新导出。");
  const positions = new Map(
    payload.positions.map((point) => [point.id, point]),
  );
  const pointById = new Map(current.points.map((point) => [point.id, point]));
  const changes: CadReturnPreview["changes"] = [];
  let unchanged = 0;
  for (const baseline of exchange.points) {
    const point = pointById.get(baseline.id);
    if (!point || !point.placed || point.floorId !== exchange.floorId)
      throw new Error(
        `点位 ${baseline.code} 已删除、取消定位或更换楼层，请重新导出。`,
      );
    const position = positions.get(point.id)!;
    const to = cadToPercent(
      exchange.drawing.window,
      position.cadX,
      position.cadY,
    );
    // Re-importing a successfully applied return must be a true no-op.
    if (samePosition(point, to)) {
      unchanged++;
      continue;
    }
    if (!samePosition(point, baseline))
      throw new Error(
        `点位 ${point.code} 导出后已在工作台移动，坐标发生冲突，请重新导出后调整。`,
      );
    changes.push({
      id: point.id,
      code: point.code!,
      from: { x: point.x, y: point.y },
      to,
    });
  }
  return { payload, changes, unchanged };
}

export async function applyCadReturn(
  plan: PointMapPlan,
  value: unknown,
): Promise<{ plan: PointMapPlan; updated: number; unchanged: number }> {
  const preview = await previewCadReturn(plan, value);
  if (!preview.changes.length)
    return { plan, updated: 0, unchanged: preview.unchanged };
  const changes = new Map(
    preview.changes.map((change) => [change.id, change.to]),
  );
  const reason = "Cadcraft 已调整位置，请重新复核安装位置及关联场景。";
  const next = normalizeDesignPlan({
    ...plan,
    points: plan.points.map((point) =>
      changes.has(point.id)
        ? {
            ...point,
            ...changes.get(point.id)!,
            status: "changed",
            reviewReason: point.reviewReason?.includes(reason)
              ? point.reviewReason
              : [point.reviewReason, reason].filter(Boolean).join("；"),
          }
        : point,
    ),
    scenes: (plan.scenes ?? []).map((scene) =>
      scene.pointIds.some((id) => changes.has(id))
        ? { ...scene, status: "proposed" }
        : scene,
    ),
    updatedAt: new Date().toISOString(),
  });
  return {
    plan: next,
    updated: preview.changes.length,
    unchanged: preview.unchanged,
  };
}

async function backgroundSha256(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function samePosition(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6;
}
