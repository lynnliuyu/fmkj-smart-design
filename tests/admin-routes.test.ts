import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const ADMIN_API_ROOT = join(process.cwd(), "app/api/admin")

// Scan the directory instead of keeping a hand written list: a new admin route
// used to be able to skip this guard simply by not being added here.
const adminRouteFiles = (readdirSync(ADMIN_API_ROOT, { recursive: true }) as string[])
  .filter((file) => file.endsWith("route.ts"))
  .sort()

const guardedProductMutationFiles = [
  "app/api/products/route.ts",
  "app/api/products/[id]/image/route.ts",
]

describe("admin routes", () => {
  it("finds every admin API route on disk", () => {
    expect(adminRouteFiles.length).toBeGreaterThan(0)
    expect(adminRouteFiles).toContain(join("products", "route.ts"))
  })

  it("guards every admin API route with super-admin authorization", () => {
    for (const file of adminRouteFiles) {
      const source = readFileSync(join(ADMIN_API_ROOT, file), "utf8")

      expect(source, file).toContain("requireSuperAdmin")
      expect(source, file).toContain("requireSuperAdmin()")
    }
  })

  it("guards public product catalogue mutations with super-admin authorization", () => {
    for (const file of guardedProductMutationFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8")

      expect(source, file).toContain("requireSuperAdmin()")
      expect(source, file).toMatch(/admin(Api|Auth)ErrorResponse\(/)
    }
  })

  it("returns standardized admin authorization errors", () => {
    for (const file of adminRouteFiles) {
      const source = readFileSync(join(ADMIN_API_ROOT, file), "utf8")

      expect(source, file).toMatch(/admin(Api|Auth)ErrorResponse\(error\)/)
    }
  })
})
