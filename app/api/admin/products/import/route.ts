import { NextRequest, NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { listProductDictionaries } from "@/lib/product-dictionaries"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { applyProductImport, previewProductImport } from "@/lib/product-import-service"

/**
 * 产品库表格导入。
 *
 * 同一个端点两种模式：`preview` 只算不写，`apply` 才落库，且会**重新解析一遍**——
 * 预演结果只是给操作者看的，落库时不能信任前端回传的结论。
 */
export async function POST(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const csv = String(body?.csv ?? "")

    if (!csv.trim()) {
      return NextResponse.json({ error: "CSV_EMPTY", message: "请先选择要导入的表格文件" }, { status: 400 })
    }

    if (body?.mode === "apply") {
      // 手动导入走严格校验：品牌/型号必须来自字典（官方资料同步是另一条路，不以本地字典为准）。
      return NextResponse.json({ result: await applyProductImport(csv, context.user.userId, {}, { dictionaries: await listProductDictionaries() }) })
    }

    return NextResponse.json({ preview: await previewProductImport(csv) })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
