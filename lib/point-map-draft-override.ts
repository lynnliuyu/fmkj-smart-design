import type { PointMapPlan } from "./point-map-plan"

export type PointMapOverrideDependencies = {
  /** 读取云端当前草稿与 revision：既是要替换掉的内容，也是这次写入的乐观锁基准。 */
  read: () => Promise<{ plan: PointMapPlan | null; revision: number }>
  /** 覆盖前保存被替换的云端稿；失败不阻塞覆盖，只是没有可导出的备份。 */
  backup: (plan: PointMapPlan) => Promise<void>
  /** 以给定 revision 为基准写库。 */
  save: (plan: PointMapPlan, expectedRevision: number) => Promise<{ plan: PointMapPlan | null; revision: number }>
  normalize: (plan: PointMapPlan) => PointMapPlan
}

export type PointMapOverrideOutcome = {
  plan: PointMapPlan
  revision: number
  /** 被替换掉的云端 revision；0 表示云端原本没有草稿。 */
  replacedRevision: number
  replaced: boolean
  backupStored: boolean
}

/**
 * 单人单机下冲突只来自使用者自己的并发操作，因此允许显式「以本机为准」覆盖。
 *
 * 关键约束：覆盖不是绕过乐观锁。必须先用 `read()` 取回云端当前 revision 作为基准，
 * 再把云端当前稿当作「被替换的一版」备份下来。这样即使云端在被点按钮的瞬间又被改过，
 * 写入也会以 409 失败而不是静默覆盖。
 */
export async function overridePointMapDraft(
  dependencies: PointMapOverrideDependencies,
  localPlan: PointMapPlan,
): Promise<PointMapOverrideOutcome> {
  const current = await dependencies.read()
  const replaced = current.plan ? dependencies.normalize(current.plan) : null
  let backupStored = false
  if (replaced) {
    try {
      await dependencies.backup(replaced)
      backupStored = true
    } catch {
      // 内存备份在本页面关闭前仍可导出；覆盖本身不应因为备份失败而中断。
      backupStored = false
    }
  }
  const submitted = dependencies.normalize(localPlan)
  const saved = await dependencies.save(submitted, current.revision)
  return {
    plan: saved.plan ? dependencies.normalize(saved.plan) : submitted,
    revision: saved.revision,
    replacedRevision: current.revision,
    replaced: replaced !== null,
    backupStored,
  }
}
