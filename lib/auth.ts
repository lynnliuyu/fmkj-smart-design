import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { getSessionSecretBytes } from "./session-secret"

const SESSION_COOKIE_NAME = "session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

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
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  })
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token)
}
