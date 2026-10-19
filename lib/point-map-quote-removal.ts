import type { PointMapPlan } from "./point-map-plan"

type SourcedLine = { room: string; pointMapProjectId?: string; pointIds?: string[] }

/** 报价行按点位合并，删除一行 = 删除该行 pointIds 对应的所有点位。 */
export function pointIdsRemovedByLines(removedLines: SourcedLine[]): string[] {
  return [...new Set(removedLines.flatMap((line) => (line.pointMapProjectId ? line.pointIds ?? [] : [])))]
}

type LocalDraftStore = {
  read(projectId: string): Promise<{ plan: PointMapPlan } | null>
  write(plan: PointMapPlan): Promise<void>
}

/**
 * 报价保存会直接改云端点位（删点、换房间），本机点位草稿也要同步，
 * 否则下次打开点位图仍载入旧草稿，再保存就把删掉的设备写回报价。
 */
export async function syncLocalPointDraft(
  store: LocalDraftStore,
  projectId: string,
  removedPointIds: string[],
  roomMoves: Array<{ pointIds: string[]; room: string }> = [],
) {
  if (!projectId || (!removedPointIds.length && !roomMoves.length)) return false
  const local = await store.read(projectId)
  if (!local) return false
  let plan = removePointsFromPlan(local.plan, removedPointIds)
  for (const move of roomMoves) {
    const ids = new Set(move.pointIds)
    // 与服务端一致：报价房间带楼层前缀「一楼 / 客厅」，点位只存房间名
    const room = move.room.includes(" / ") ? move.room.slice(move.room.indexOf(" / ") + 3) : move.room
    plan = { ...plan, points: plan.points.map((point) => (ids.has(point.id) ? { ...point, room } : point)) }
  }
  if (plan === local.plan) return false
  await store.write(plan)
  return true
}

/** 从点位方案中移除指定点位，并清理它们在场景中的引用。 */
export function removePointsFromPlan(plan: PointMapPlan, pointIds: string[]): PointMapPlan {
  const gone = new Set(pointIds)
  if (!gone.size) return plan
  return {
    ...plan,
    points: plan.points.filter((point) => !gone.has(point.id)),
    scenes: (plan.scenes ?? []).map((scene) => scene.pointIds.some((id) => gone.has(id))
      ? { ...scene, pointIds: scene.pointIds.filter((id) => !gone.has(id)), status: "proposed" as const }
      : scene),
  }
}
