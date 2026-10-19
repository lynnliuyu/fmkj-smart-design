const LOCAL_DEVELOPMENT_SESSION_SECRET = "fmkj-local-development-session-secret"

export function getSessionSecret() {
  const secret = process.env.AUTH_SECRET

  if (!secret && process.env.NODE_ENV === "development") {
    return LOCAL_DEVELOPMENT_SESSION_SECRET
  }

  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is not set")
  }

  return secret
}

export function getSessionSecretBytes(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret())
}
