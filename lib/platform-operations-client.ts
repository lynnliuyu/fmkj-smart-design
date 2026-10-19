import type { AccountStatus, AccountType, PlanCode } from "./account-system/domain"
import type {
  PlatformCustomer,
  PlatformFeatureFlag,
  PlatformPlan,
} from "./account-system/platform-admin-service"

export type CreatePlatformCustomerInput = {
  accountType: AccountType
  email: string
  name: string
  password?: string
  phone?: string
  planCode: PlanCode
}

export type UpdatePlatformCustomerInput = {
  accountStatus: AccountStatus
  accountType: AccountType
  customerId: string
}

export class PlatformOperationClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "PlatformOperationClientError"
  }
}

export async function listPlatformCustomersClient() {
  const data = await requestPlatformOperation<{ customers?: PlatformCustomer[] }>("/api/admin/customers")
  return data.customers ?? []
}

export async function createPlatformCustomerClient(input: CreatePlatformCustomerInput) {
  const data = await requestPlatformOperation<{ customer?: PlatformCustomer }>("/api/admin/customers", {
    body: input,
    method: "POST",
  })
  return requirePayload(data.customer, "客户创建失败")
}

export async function updatePlatformCustomerClient(input: UpdatePlatformCustomerInput) {
  const data = await requestPlatformOperation<{ customer?: PlatformCustomer }>(`/api/admin/customers/${input.customerId}`, {
    body: {
      accountStatus: input.accountStatus,
      accountType: input.accountType,
    },
    method: "PATCH",
  })
  return requirePayload(data.customer, "客户更新失败")
}

export async function assignPlatformCustomerPlanClient(customerId: string, planCode: PlanCode) {
  const data = await requestPlatformOperation<{ customer?: PlatformCustomer }>(
    `/api/admin/customers/${customerId}/subscription`,
    {
      body: { planCode },
      method: "PATCH",
    }
  )
  return requirePayload(data.customer, "套餐分配失败")
}

export async function updatePlatformPlanClient(plan: PlatformPlan) {
  const data = await requestPlatformOperation<{ plan?: PlatformPlan }>(`/api/admin/plans/${plan.id}`, {
    body: plan,
    method: "PATCH",
  })
  return requirePayload(data.plan, "套餐保存失败")
}

export async function updatePlatformFeatureFlagClient(flag: PlatformFeatureFlag, enabled: boolean) {
  const data = await requestPlatformOperation<{ featureFlag?: PlatformFeatureFlag }>("/api/admin/feature-flags", {
    body: {
      description: flag.description,
      enabled,
      key: flag.key,
    },
    method: "PATCH",
  })
  return requirePayload(data.featureFlag, "功能开关更新失败")
}

async function requestPlatformOperation<T>(
  url: string,
  options: { body?: unknown; method?: "GET" | "PATCH" | "POST" } = {}
): Promise<T> {
  const response = await fetch(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    method: options.method ?? "GET",
  })
  const data = (await response.json().catch(() => ({}))) as T & {
    details?: Record<string, string>
    error?: string
  }

  if (!response.ok) {
    throw new PlatformOperationClientError(formatPlatformOperationError(data), response.status)
  }

  return data
}

function requirePayload<T>(value: T | null | undefined, fallback: string) {
  if (!value) {
    throw new PlatformOperationClientError(fallback, 500)
  }

  return value
}

function formatPlatformOperationError(data: { details?: Record<string, string>; error?: string }) {
  if (data.details && Object.keys(data.details).length > 0) {
    return Object.values(data.details).join("; ")
  }

  return data.error ?? "平台运营操作失败"
}
