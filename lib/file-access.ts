import { LOCAL_FILE_PREFIX } from "./file-storage"

/**
 * 本地附件的读取授权。
 *
 * 依据是数据库里的记录而不是路径本身：攻击者可以伪造任何路径，但不能伪造一条
 * 属于别人项目的 project_attachments 记录。
 * 因此顺序是「按记录找到项目 → 判断项目可见性」，两条都查不到才看是否是
 * 部署内共享（商品图）或本人资源（头像、公司标志）。
 */
export const SHARED_KINDS = new Set(["product-images", "avatars", "company-logos"])

type Row = { projectId?: unknown }

export type FileAccessDependencies = {
  /** 执行参数化查询；测试里可以注入假实现。 */
  query: (sql: string, params: unknown[]) => Promise<{ rows: Row[] }>
  /** 当前账号是否能看到该项目（复用项目可见性规则）。 */
  canSeeProject: (projectId: string) => Promise<boolean>
}

export async function canReadLocalFile(
  pathname: string,
  dependencies: FileAccessDependencies,
): Promise<boolean> {
  if (!pathname) return false

  const attachment = await dependencies.query(
    `select project_id::text as "projectId"
     from project_attachments
     where file_url = $1 and deleted_at is null
     limit 1`,
    [LOCAL_FILE_PREFIX + pathname],
  )
  const attachmentProject = attachment.rows[0]?.projectId
  if (typeof attachmentProject === "string" && attachmentProject)
    return dependencies.canSeeProject(attachmentProject)

  return SHARED_KINDS.has(pathname.split("/")[0])
}
