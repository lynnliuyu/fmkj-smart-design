import { NextRequest, NextResponse } from "next/server"
import { jwtVerify } from "jose"
import { getSessionSecretBytes } from "@/lib/session-secret"

// /setup 是全新设备的首次初始化页：这时还没有任何账号，必须先放行。
const publicPaths = ["/login", "/sign-up", "/forgot-password", "/errors", "/showcase", "/setup"]
// /api/catalog/* 是给订阅设备拉官方资料与素材的：设备没有会话 Cookie，凭据是 Bearer
// 令牌，由各路由自己校验。只放开这两条精确路径，不放整个 /api/catalog 前缀。
const publicApiPaths = ["/api/auth", "/api/catalog/snapshot", "/api/catalog/asset", "/api/setup"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    publicPaths.some((p) => pathname.startsWith(p)) ||
    publicApiPaths.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next()
  }

  const sessionToken = request.cookies.get("session")?.value

  if (!sessionToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  try {
    const { payload } = await jwtVerify(sessionToken, getSessionSecretBytes())
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-user-id", String(payload.sub ?? ""))
    requestHeaders.set("x-user-role", String(payload.role ?? "member"))
    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 401 })
      response.cookies.delete("session")
      return response
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    const response = NextResponse.redirect(loginUrl)
    response.cookies.delete("session")
    return response
  }
}

export const config = {
  matcher: [
    // 恢复备份要把整个备份包传上来（几百 MB）。中间件会按 proxyClientMaxBodySize 复制请求体，
    // 超过 32MB 就被截断成一个坏包，所以这条路径不进中间件。
    // 不代表它没人守：该路由自己调 requireSuperAdmin()，比中间件只查「有没有会话」更严，
    // 而且它先校验权限、再读请求体，未登录的请求根本不会被读进内存。
    "/api/((?!admin/backup).*)",
    "/((?!login|sign-up|forgot-password|errors|setup|_next|favicon.ico|public|assets|api/admin/backup).*)",
  ],
}
