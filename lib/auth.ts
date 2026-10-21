import { SignJWT, jwtVerify } from "jose"
import { cookies, headers } from "next/headers"
import { getSessionSecretBytes } from "./session-secret"

const SESSION_COOKIE_NAME = "session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

/**
 * Cookie 的 Secure 标志。
 *
 * 不能简单地用 `NODE_ENV === "production"`：本地设备版在生产模式下用
 * `http://<设备IP>:3000` 在局域网里访问，带 Secure 的 Cookie 浏览器根本不会保存，
 * 表现就是「登录接口返回 200，人却还是未登录」。托管版走 HTTPS（Vercel 会带
 * `x-forwarded-proto: https`），因此按实际协议判断；自建反向代理没带该头时，
 * 用 AUTH_COOKIE_SECURE=true 显式打开。
 */
export function shouldUseSecureCookie(forwardedProto?: string | null): boolean {
  const configured = (process.env.AUTH_COOKIE_SECURE ?? "auto").trim().toLowerCase()
  if (configured === "true") return true
  if (configured === "false") return false
  return forwardedProto?.split(",")[0].trim().toLowerCase() === "https"
}

async function baseCookieOptions() {
  const headerStore = await headers()
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(headerStore.get("x-forwarded-proto")),
    sameSite: "lax" as const,
    path: "/",
  }
}

export type AuthUser = {
  userId: string
  email?: string | null
  phone?: string | null
  name: string
  role: string
}

export async function signSessionToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    userId: user.userId,
    email: user.email ?? null,
    phone: user.phone ?? null,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .setSubject(user.userId)
    .sign(getSessionSecretBytes())
}

export async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretBytes())
    return {
      userId: (payload.sub ?? payload.userId) as string,
      email: (payload.email as string | null) ?? null,
      phone: (payload.phone as string | null) ?? null,
      name: (payload.name as string) ?? "",
      role: (payload.role as string) ?? "member",
    }
  } catch {
    return null
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...await baseCookieOptions(),
    maxAge: SESSION_MAX_AGE,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...await baseCookieOptions(),
    maxAge: 0,
  })
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token)
}
