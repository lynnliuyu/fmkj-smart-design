import { afterEach, describe, expect, it } from "vitest"

import { getAccessAnalytics, getDatabaseStatus, getEnvironmentStatus } from "../lib/platform-health.js"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("platform health", () => {
  it("reports environment presence without raw values", () => {
    process.env.DATABASE_URL = "postgres://user:password@example.com/db"
    process.env.AUTH_SECRET = "super-secret-value"
    delete process.env.JWT_SECRET

    const status = getEnvironmentStatus()
    const serialized = JSON.stringify(status)

    expect(status.ready).toBe(true)
    expect(serialized).toContain("DATABASE_URL")
    expect(serialized).toContain("AUTH_SECRET")
    expect(serialized).not.toContain("super-secret-value")
    expect(serialized).not.toContain("postgres://user:password@example.com/db")
  })

  it("does not accept the obsolete JWT_SECRET in place of the session secret", () => {
    process.env.DATABASE_URL = "postgres://user:password@example.com/db"
    process.env.JWT_SECRET = "obsolete-test-value"
    delete process.env.AUTH_SECRET

    expect(getEnvironmentStatus().ready).toBe(false)
  })

  it("degrades safely when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL

    await expect(getDatabaseStatus()).resolves.toMatchObject({
      connected: false,
      errorCode: "DATABASE_URL_MISSING",
      totalRows: 0,
    })
  })

  it("returns empty analytics with operational fields when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL

    await expect(getAccessAnalytics()).resolves.toEqual({
      activeActors7d: 0,
      actions24h: 0,
      actions7d: [],
      accountsByStatus: [],
      accountsByType: [],
      ordersByStatus: [],
      organizationsByStatus: [],
      paidRevenueCents: 0,
      subscriptionsByStatus: [],
      topActions: [],
      topModules: [],
    })
  })
})
