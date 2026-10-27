import { isSuperAdminContext } from "./admin-auth"
import { accountContextCan, type AccountContext } from "./account-context"
import { requireAccountPermission } from "./account-gates"

/**
 * 上传的归属授权。
 *
 * 原来这条路只问了一句「你登录了吗」，`kind` 和 `entityId` 全部由表单决定——任何登录用户都能
 * 把文件写进**别人项目的目录**或共享的商品图目录。附件记录那一步有项目可见性校验，
 * 但文件本身不该先落进别人的命名空间。
 *
 * 规则（每一条都对应一个真实调用方，见各调用点）：
 *   avatar         → 只能传给自己，目录用调用者自己的用户 id（不再用表单里的 "current"）
 *   company_logo   → 只能传给自己的组织，且要有管理成员的权限
 *   product_image  → 与产品管理同一把锁：超级管理员
 *   contract / floorplan / quote_pdf / attachment → 必须是调用者能编辑的项目
 *
 * 认不出的 kind 一律拒绝，不回退到「随便放一个目录」。
 */

export const UPLOAD_FOLDERS = {
  attachment: "attachments",
  avatar: "avatars",
  company_logo: "company-logos",
  contract: "contracts",
  floorplan: "floorplans",
  product_image: "product-images",
  quote_pdf: "quote-pdfs",
} as const

export type UploadKind = keyof typeof UPLOAD_FOLDERS

/** 需要按项目归属判定的上传类型。 */
const PROJECT_KINDS = new Set<UploadKind>(["attachment", "contract", "floorplan", "quote_pdf"])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type UploadAccessDependencies = {
  /** 这个账号能不能编辑该项目（项目可见性 + project.edit 权限）。 */
  canEditProject?: (projectId: string) => Promise<boolean>
  /** 商品是否存在（避免往不存在的商品目录里塞文件）。 */
  productExists?: (productId: string) => Promise<boolean>
}

export type UploadAccess =
  | { ok: true; folder: string; ownerId: string }
  | { ok: false; reason: string; status: 400 | 403 | 404 }

export function isUploadKind(value: string): value is UploadKind {
  return Object.hasOwn(UPLOAD_FOLDERS, value)
}

export async function authorizeUpload(
  context: AccountContext | null,
  kind: string,
  entityId: string,
  dependencies: UploadAccessDependencies = {},
): Promise<UploadAccess> {
  if (!context) return { ok: false, reason: "UNAUTHORIZED", status: 403 }
  if (context.account.status !== "active") return { ok: false, reason: "ACCOUNT_DISABLED", status: 403 }
  if (!isUploadKind(kind)) return { ok: false, reason: "UPLOAD_KIND_NOT_ALLOWED", status: 400 }

  if (kind === "avatar") {
    // 头像属于本人：忽略表单里的 entityId，避免往别人的目录里写。
    return { ok: true, folder: UPLOAD_FOLDERS.avatar, ownerId: context.user.userId }
  }

  if (kind === "company_logo") {
    // 设备版的管理员往往没有「组织」这个对象（整台设备就是他的公司），
    // 所以平台管理员也能传 logo——报价单上要印的就是他公司的名字。
    if (isSuperAdminContext(context) && !context.organization?.id) {
      return { ok: true, folder: UPLOAD_FOLDERS.company_logo, ownerId: "platform" }
    }
    const organizationId = context.organization?.id
    if (!organizationId) return { ok: false, reason: "ORGANIZATION_REQUIRED", status: 403 }
    if (!accountContextCan(context, "enterprise.manage_members") && !context.account.canManageTeam) {
      return { ok: false, reason: "ORGANIZATION_LOGO_NOT_ALLOWED", status: 403 }
    }
    // 允许 "current" 这种占位值，但只落到自己的组织目录。
    if (entityId && entityId !== "current" && entityId !== organizationId) {
      return { ok: false, reason: "ORGANIZATION_MISMATCH", status: 403 }
    }
    return { ok: true, folder: UPLOAD_FOLDERS.company_logo, ownerId: organizationId }
  }

  if (kind === "product_image") {
    if (!isSuperAdminContext(context)) return { ok: false, reason: "PLATFORM_ADMIN_REQUIRED", status: 403 }
    if (!UUID.test(entityId)) return { ok: false, reason: "PRODUCT_ID_REQUIRED", status: 400 }
    if (dependencies.productExists && !(await dependencies.productExists(entityId))) {
      return { ok: false, reason: "PRODUCT_NOT_FOUND", status: 404 }
    }
    return { ok: true, folder: UPLOAD_FOLDERS.product_image, ownerId: entityId }
  }

  if (PROJECT_KINDS.has(kind)) {
    if (!UUID.test(entityId)) return { ok: false, reason: "PROJECT_ID_REQUIRED", status: 400 }
    const edit = requireAccountPermission(context, "project.edit")
    if (!edit.allowed) return { ok: false, reason: edit.reason, status: 403 }
    if (!dependencies.canEditProject || !(await dependencies.canEditProject(entityId))) {
      return { ok: false, reason: "RESOURCE_NOT_FOUND_OR_NOT_OWNED", status: 403 }
    }
    return { ok: true, folder: UPLOAD_FOLDERS[kind], ownerId: entityId }
  }

  return { ok: false, reason: "UPLOAD_KIND_NOT_ALLOWED", status: 400 }
}
