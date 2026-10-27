import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * 产品写入接口必须把「系列」透传下去。
 *
 * 真 bug：`/api/admin/products/[id]` 的 PATCH 早期只透传 brand/name/…，漏了 series。
 * 结果批量脚本每 PATCH 一次就把产品的系列写成 null——507 条系列悄悄变成 17 条，
 * 而且不报错、界面看不出来。这里用结构性检查锁住：三个写入口都必须提到 series。
 */
describe("产品写入接口的字段透传", () => {
  const routes = [
    "app/api/admin/products/route.ts",
    "app/api/admin/products/[id]/route.ts",
    "app/api/products/route.ts",
  ]

  it("新建/更新产品都要把 series 传进写入服务", () => {
    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), route), "utf8")
      expect(source, `${route} 漏了 series`).toMatch(/series:\s*/)
      expect(source, `${route} 的 series 必须是「没传就保持原值」而不是默认清空`).toMatch(
        /series:\s*(body\.series === undefined|optionalString\(body\.series\))/,
      )
    }
  })

  it("写入服务本身也要处理 series（插入与更新）", () => {
    const source = readFileSync(join(process.cwd(), "lib/product-admin-service.ts"), "utf8")
    expect(source).toMatch(/selection_reviewed_at, platforms, series/)
    expect(source).toMatch(/series=\$31/)
    expect(source).toMatch(/series,\s*\n\s*category,/)
  })
})
