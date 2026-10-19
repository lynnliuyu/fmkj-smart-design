import { NextResponse } from "next/server"

import {
  accountContextCan,
  getCurrentAccountContext,
  type AccountContext,
} from "./account-context"

export type AdminAuthErrorCode = "UNAUTHORIZED" | "PLATFORM_ADMIN_REQUIRED"

export class AdminAuthError extends Error {
  code: AdminAuthErrorCode
  status: 401 | 403

  constructor(code: AdminAuthErrorCode) {
    super(code)
    this.name = "AdminAuthError"
    this.code = code
    this.status = code === "UNAUTHORIZED" ? 401 : 403
  }
}

export function isSuperAdminContext(context: AccountContext | null): context is AccountContext {
  return Boolean(
    context?.account.isSuperAdmin &&
      accountContextCan(context, "account.manage_all") &&
      accountContextCan(context, "platform.manage_features")
  )
}

export async function requireSuperAdmin() {
  const context = await getCurrentAccountContext()

  if (!context) {
    throw new AdminAuthError("UNAUTHORIZED")
  }

  if (!isSuperAdminContext(context)) {
    throw new AdminAuthError("PLATFORM_ADMIN_REQUIRED")
  }

  return context
}

export function adminJsonForbidden(error: AdminAuthErrorCode = "PLATFORM_ADMIN_REQUIRED") {
  return NextResponse.json({ error }, { status: error === "UNAUTHORIZED" ? 401 : 403 })
}

export function adminAuthErrorResponse(error: unknown) {
  if (error instanceof AdminAuthError) {
    return adminJsonForbidden(error.code)
  }

  throw error
}
