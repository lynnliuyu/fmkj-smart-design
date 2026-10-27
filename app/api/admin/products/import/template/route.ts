import { NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { buildImportTemplate } from "@/lib/product-import"

/**
 * 下载导入模板。带 UTF-8 BOM 并用 CRLF 换行：这样 Excel 双击打开中文表头不是乱码，
 * 也不会把整张表挤成一列。
 */
export async function GET() {
  try {
    await requireSuperAdmin()

    return new NextResponse(`\uFEFF${buildImportTemplate()}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="product-import-template.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
