import { afterEach, describe, expect, it, vi } from "vitest"

import { shouldUseSecureCookie } from "../lib/auth"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("会话 Cookie 的 Secure 标志", () => {
  it("follows the actual protocol when AUTH_COOKIE_SECURE is auto", () => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "auto")
    expect(shouldUseSecureCookie("https")).toBe(true)
    expect(shouldUseSecureCookie("https, http")).toBe(true)
    expect(shouldUseSecureCookie("http")).toBe(false)
    // 采集不到协议头时按不安全处理（安全默认值）。
    expect(shouldUseSecureCookie(undefined)).toBe(false)
    expect(shouldUseSecureCookie(null)).toBe(false)
  })

  it("treats an unset variable as auto", () => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "")
    expect(shouldUseSecureCookie("https")).toBe(true)
    expect(shouldUseSecureCookie("http")).toBe(false)
  })

  it("honours an explicit override for reverse proxies that strip the header", () => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "true")
    expect(shouldUseSecureCookie("http")).toBe(true)
    vi.stubEnv("AUTH_COOKIE_SECURE", "false")
    expect(shouldUseSecureCookie("https")).toBe(false)
  })
})
