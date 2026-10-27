import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

// Guards that can stand in for "this request is allowed to touch the database".
// Everything here ultimately derives from the signed session cookie that
// middleware verifies, so a route that matches none of them is open to any
// signed-in account.
const GUARD_IDENTIFIERS = [
  "requireSuperAdmin",
  "getCurrentAccountContext",
  "getSessionUser",
  "requireAccountPermission",
] as const

// Kept as an empty registry on purpose: an exception here is a promise that the
// route cannot touch another account's data. `/api/upload` used to live here and
// now resolves the account context itself, so it is guarded like every other route.
const IDENTITY_ONLY_WRITES: Record<string, string> = {}

const IDENTITY_IDENTIFIER = "getAuthenticatedUserId"

// Endpoints called by something that is not a browser session (a subscriber
// device, a deployment script). They cannot use the session cookie, so they must
// verify a bearer credential themselves — which this test checks, not just trusts.
const TOKEN_AUTHENTICATED: Record<string, string> = {
  "app/api/catalog/snapshot/route.ts":
    "pulled by subscriber devices: verifies Bearer CATALOG_PUBLISH_TOKEN and answers 404 when no token is configured",
  "app/api/catalog/asset/route.ts":
    "pulled by subscriber devices for catalog images: same Bearer check, plus path containment under public/ and an image extension allowlist",
}

/**
 * A token-guarded route has to actually compare a bearer credential, not just claim to.
 *
 * 允许两种写法：路由自己比较，或**委托给统一的凭据校验模块**（lib/catalog-auth.ts）。
 * 后者是更好的设计（两个取资料入口共用一套守卫，不会改一处漏一处），但要求：
 *   - 路由确实调用了那个校验函数；
 *   - 被委托的模块自己做常量时间比较、也返回 401。
 */
const CATALOG_AUTH_MODULE = join("lib", "catalog-auth.ts")

function comparesBearer(source: string) {
  return /authorization/i.test(source) && /Bearer/i.test(source) && /401/.test(source) && /timingSafeEqual|safeEqual|!==\s*expected|===\s*expected/.test(source)
}

function verifiesBearerToken(source: string) {
  if (comparesBearer(source)) return true
  if (!/authorizeCatalogRequest\s*\(/.test(source)) return false
  const helper = readFileSync(join(process.cwd(), CATALOG_AUTH_MODULE), "utf8")
  return /authorizeCatalogRequest/.test(helper) && /Bearer/i.test(helper) && /401/.test(helper) && /safeEqual|timingSafeEqual/.test(helper)
}

// Login, sign-up, password reset and verification codes must work before a
// session exists. Nothing outside this prefix may skip a guard.
const PUBLIC_API_PREFIX = join("app", "api", "auth") + "/"

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const

function routeFiles() {
  return (readdirSync(join(process.cwd(), "app/api"), { recursive: true }) as string[])
    .filter((file) => file.endsWith("route.ts"))
    .map((file) => join("app/api", file))
    .sort()
}

function exportedMethods(source: string) {
  const methods = new Set<string>()
  for (const match of source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    methods.add(match[1])
  }
  return [...methods]
}

function importedLibModules(source: string) {
  const modules: string[] = []
  for (const match of source.matchAll(/from\s+"(@\/lib\/[^"]+|\.\.\/[^"]+|\.\/[^"]+)"/g)) {
    const specifier = match[1]
    const base = specifier.startsWith("@/lib/")
      ? join("lib", specifier.slice("@/lib/".length))
      : null
    if (base) modules.push(base)
  }
  return modules
}

function readModule(base: string) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      return readFileSync(join(process.cwd(), candidate), "utf8")
    } catch {
      continue
    }
  }
  return null
}

/** Imports alone must not count: drop them before looking for a real reference. */
function withoutImports(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line))
    .join("\n")
}

function guardsIn(text: string) {
  const body = withoutImports(text)
  return GUARD_IDENTIFIERS.filter((identifier) => body.includes(identifier))
}

function usesIdentityHeader(text: string) {
  return withoutImports(text).includes(IDENTITY_IDENTIFIER)
}

/**
 * A route can either call a guard itself or delegate to a lib handler factory.
 * One level of indirection is enough for this codebase; if a factory ever grows a
 * second layer, this helper reports the route as unguarded and forces a decision
 * instead of silently passing.
 */
function guardsFor(file: string) {
  const source = readFileSync(join(process.cwd(), file), "utf8")
  const direct = guardsIn(source)
  if (direct.length > 0) return { guards: direct, via: file, identityOnly: false }

  for (const moduleBase of importedLibModules(source)) {
    const moduleSource = readModule(moduleBase)
    if (!moduleSource) continue
    const guards = guardsIn(moduleSource)
    if (guards.length > 0) return { guards, via: `${moduleBase}.ts`, identityOnly: false }
  }

  return { guards: [] as string[], via: null as string | null, identityOnly: usesIdentityHeader(source) }
}

describe("API authorization surface", () => {
  const files = routeFiles()

  it("finds the route tree", () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files.some((file) => file.endsWith(join("products", "route.ts")))).toBe(true)
  })

  it("keeps the public prefix limited to auth endpoints", () => {
    const publicFiles = files.filter((file) => file.replaceAll("\\", "/").includes("/api/auth/"))
    expect(publicFiles.length).toBeGreaterThan(0)
    for (const file of publicFiles) {
      expect(file.startsWith(PUBLIC_API_PREFIX), file).toBe(true)
    }
  })

  it("guards every mutating handler", () => {
    const unguarded: string[] = []

    for (const file of files) {
      const normalized = file.replaceAll("\\", "/")
      if (normalized.includes("/api/auth/")) continue

      const source = readFileSync(join(process.cwd(), file), "utf8")
      const mutating = exportedMethods(source).filter((method) =>
        MUTATING_METHODS.includes(method as (typeof MUTATING_METHODS)[number])
      )
      if (mutating.length === 0) continue

      const { guards, via, identityOnly } = guardsFor(file)

      if (guards.length === 0) {
        if (identityOnly && IDENTITY_ONLY_WRITES[normalized]) continue
        unguarded.push(`${normalized} [${mutating.join(", ")}]`)
        continue
      }

      // Catching a file that swapped a real permission check for the middleware
      // identity header is the whole point of this test.
      expect(via, normalized).not.toBeNull()
    }

    expect(unguarded, `unauthorized writes:\n${unguarded.join("\n")}`).toEqual([])
  })

  it("does not keep stale identity-only exceptions", () => {
    for (const [file, reason] of Object.entries(IDENTITY_ONLY_WRITES)) {
      expect(files, file).toContain(file)
      expect(reason.length, file).toBeGreaterThan(20)
    }
  })

  it("guards every read handler", () => {
    const unguarded: string[] = []

    for (const file of files) {
      const normalized = file.replaceAll("\\", "/")
      if (normalized.includes("/api/auth/")) continue

      const source = readFileSync(join(process.cwd(), file), "utf8")
      if (!exportedMethods(source).includes("GET")) continue

      const { guards } = guardsFor(file)
      if (guards.length === 0) {
        if (TOKEN_AUTHENTICATED[normalized] && verifiesBearerToken(source)) continue
        unguarded.push(normalized)
      }
    }

    expect(unguarded, `unauthorized reads:\n${unguarded.join("\n")}`).toEqual([])
  })

  it("does not keep stale token exceptions, and each one really checks a bearer token", () => {
    for (const [file, reason] of Object.entries(TOKEN_AUTHENTICATED)) {
      expect(files, file).toContain(file)
      expect(reason.length, file).toBeGreaterThan(20)
      expect(verifiesBearerToken(readFileSync(join(process.cwd(), file), "utf8")), file).toBe(true)
    }
  })

  it("scopes attachments to projects the account can see", () => {
    const source = readFileSync(join(process.cwd(), "app/api/attachments/route.ts"), "utf8")

    expect(source).toContain("getCurrentAccountContext()")
    expect(source).toContain("projectVisibilityWhere(")
    expect(source).toContain('requireAccountPermission(context, "project.edit")')
    // Attribution has to come from the session, never from a hard-coded id.
    expect(source).not.toMatch(/SYSTEM_USER_ID\s*=\s*"10000000-0000-0000-0000-000000000002"/)
    expect(source).toContain("context.user.userId")
  })
})
