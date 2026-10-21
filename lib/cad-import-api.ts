import { NextResponse } from "next/server"

import { getCurrentAccountContext } from "./account-context"
import {
  CAD_IMPORT_MAX_BYTES,
  CadImportError,
  cadImportConfig,
  mergeDraftIntoPlan,
  requestCadImport,
  type CadImportConfig,
} from "./point-map-cad-import"
import { emptyPointMapPlan, type PointMapPlan } from "./point-map-plan"
import { getProjectPointMap, PointMapServiceError, saveProjectPointMap } from "./point-map-service"

type RouteContext = { params: Promise<{ id: string }> }
type Dependencies = {
  getContext?: typeof getCurrentAccountContext
  read?: typeof getProjectPointMap
  save?: typeof saveProjectPointMap
  config?: () => CadImportConfig | null
  importDraft?: typeof requestCadImport
}

/** 与点位接口一致的错误出口：只回错误码与可读信息，不带服务端细节。 */
export function cadImportErrorResponse(error: unknown) {
  if (error instanceof CadImportError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
  if (error instanceof PointMapServiceError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
  return NextResponse.json({ code: "CAD_IMPORT_INTERNAL", error: "导入失败，请查看服务日志。" }, { status: 500 })
}

function filenameFrom(request: Request) {
  const name = new URL(request.url).searchParams.get("filename") ?? ""
  if (!name || name.length > 180 || /[/\\\u0000-\u001f\u007f]/.test(name) || !/^.+\.(dwg|dxf)$/i.test(name)) {
    throw new CadImportError("CAD_IMPORT_BAD_FILENAME", "请提供不含路径的 DWG / DXF 文件名。", 400)
  }
  return name
}

/**
 * POST /api/projects/[id]/cad-import
 *
 * 请求体是 CAD 原始字节（application/octet-stream），文件名走 ?filename=。
 * 令牌只在本进程里用，不会进响应；写库复用既有点位服务的权限与版本冲突检查。
 */
export function createCadImportApiHandlers(dependencies: Dependencies = {}) {
  return {
    async POST(request: Request, context: RouteContext) {
      try {
        const account = await (dependencies.getContext ?? getCurrentAccountContext)()
        if (!account) throw new PointMapServiceError("NOT_AUTHENTICATED", 401)
        const config = (dependencies.config ?? cadImportConfig)()
        if (!config) {
          throw new CadImportError("CAD_IMPORT_NOT_CONFIGURED", "本实例未接入 CAD 导入服务，请在服务端配置 CAD_IMPORT_SERVICE_URL 与 CAD_IMPORT_SERVICE_TOKEN。", 503)
        }
        const filename = filenameFrom(request)
        const length = Number(request.headers.get("content-length") ?? 0)
        if (length > CAD_IMPORT_MAX_BYTES) throw new CadImportError("CAD_IMPORT_TOO_LARGE", "CAD 文件超过大小限制。", 413)
        const bytes = new Uint8Array(await request.arrayBuffer())
        if (!bytes.length) throw new CadImportError("CAD_IMPORT_EMPTY_FILE", "上传内容为空。", 400)
        if (bytes.length > CAD_IMPORT_MAX_BYTES) throw new CadImportError("CAD_IMPORT_TOO_LARGE", "CAD 文件超过大小限制。", 413)
        const { id } = await context.params
        const space = new URL(request.url).searchParams.get("space") ?? undefined
        const floorName = new URL(request.url).searchParams.get("floorName") ?? undefined
        // 先取当前方案：既用于权限校验（不可见项目这里就会 403/404），也用于并发版本。
        const current = await (dependencies.read ?? getProjectPointMap)(account, id)
        const basePlan: PointMapPlan = current.data ?? emptyPointMapPlan(id)
        const { draft, id: importId } = await (dependencies.importDraft ?? requestCadImport)(config, { filename, bytes, space, floorName })
        const merged = mergeDraftIntoPlan(basePlan, draft)
        const saved = await (dependencies.save ?? saveProjectPointMap)(account, id, { plan: merged.plan, expectedRevision: current.revision })
        return NextResponse.json({
          revision: saved.revision,
          // 返回服务端已落库的方案，前端可直接采用，无需再拉一次。
          plan: saved.data,
          added: merged.added,
          skipped: merged.skipped,
          floor: draft.floors?.[0]?.name ?? null,
          pointCount: draft.points.length,
          imageWidth: draft.floors?.[0]?.imageWidth ?? null,
          imageHeight: draft.floors?.[0]?.imageHeight ?? null,
          importId,
        })
      } catch (error) {
        return cadImportErrorResponse(error)
      }
    },
  }
}
