import { NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { buildCatalogCsv } from "@/lib/catalog-sync"
import { listAdminProducts } from "@/lib/product-admin-service"

/**
 * 把产品库导出成表格，用来发给经销商导入（与「批量导入」同一种表）。
 *
 * 用的就是官方资料同步那个导出器：表头一致、CRLF 换行、尾行也带换行，
 * 所以导出来的表能被「批量导入」原样读回去。
 *
 * 成本列**留空**（导出器里就是这么定的）：这份表是给经销商看的，
 * 别把自己的进货价带出去；他们自己的进价在自己设备上填。
 * 前面加 UTF-8 BOM，Excel 双击打开中文不乱码。
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireSuperAdmin()
    const products = await listAdminProducts(null)

    return new NextResponse(`\uFEFF${buildCatalogCsv(products)}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="product-library.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    })
  } catch (error) {
    return adminApiErrorResponse(error)
  }
}
