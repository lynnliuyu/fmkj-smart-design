import { NextRequest, NextResponse } from "next/server"
import { jwtVerify } from "jose"
import { getSessionSecretBytes } from "@/lib/session-secret"

const publicPaths = ["/login", "/sign-up", "/forgot-password", "/errors", "/showcase"]
const publicApiPaths = ["/api/auth"]

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
    "/api/:path*",
    "/((?!login|sign-up|forgot-password|errors|_next|favicon.ico|public|assets).*)",
  ],
}
