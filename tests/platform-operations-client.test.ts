import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PlatformOperationClientError,
  createPlatformCustomerClient,
  updatePlatformFeatureFlagClient,
} from "../lib/platform-operations-client"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("platform operations client module", () => {
  it("returns created customers through one interface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          customer: {
            accountStatus: "active",
            accountType: "PERSONAL_FREE",
            createdAt: null,
            email: "user@example.com",
            id: "user-1",
            lastLoginAt: null,
            name: "测试客户",
            organizationId: null,
            organizationName: null,
            organizationOwnerUserId: null,
            phone: null,
            planCode: "FREE",
            planName: "免费版",
            subscriptionId: null,
            subscriptionStatus: null,
          },
        })
      )
    )

    await expect(
      createPlatformCustomerClient({
        accountType: "PERSONAL_FREE",
        email: "user@example.com",
        name: "测试客户",
        planCode: "FREE",
      })
    ).resolves.toMatchObject({ id: "user-1", name: "测试客户" })

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/customers",
      expect.objectContaining({
        method: "POST",
      })
    )
  })

  it("turns validation details into a caller-facing error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ details: { email: "邮箱不能为空", name: "名称不能为空" } }, { status: 400 })
      )
    )

    await expect(
      createPlatformCustomerClient({
        accountType: "PERSONAL_FREE",
        email: "",
        name: "",
        planCode: "FREE",
      })
    ).rejects.toMatchObject(new PlatformOperationClientError("邮箱不能为空; 名称不能为空", 400))
  })

  it("requires expected payloads from mutation routes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})))

    await expect(
      updatePlatformFeatureFlagClient(
        {
          description: null,
          enabled: false,
          key: "point_map",
          updatedAt: new Date(0).toISOString(),
          updatedByUserId: null,
        },
        true
      )
    ).rejects.toMatchObject(new PlatformOperationClientError("功能开关更新失败", 500))
  })
})
