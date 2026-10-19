import type { ProjectDeliverySnapshot, ProjectDeliverySummary } from "./project-delivery"
import type { SavedQuoteExportSnapshot } from "./quote-authoring"

class DeliveryRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}

async function deliveryRequest<T>(url: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(url, { ...init, cache: "no-store" })
  const payload = await response.json().catch(() => null) as { data?: T; error?: string; code?: string; issues?: string[] } | null
  if (!response.ok || !payload || !("data" in payload)) {
    throw new DeliveryRequestError(payload?.issues?.length ? payload.issues.join("；") : response.status === 401 ? "登录已失效，请重新登录后生成。" : response.status === 403 ? "当前项目只读，无法生成或修改交付版本。" : payload?.error || "方案资料暂时不可用，请重试。", response.status, payload?.code)
  }
  return payload.data!
}

export function loadDeliveryPreview(projectId: string) {
  return deliveryRequest<ProjectDeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/deliveries?preview=1`)
}
export function loadProjectDelivery(projectId: string, deliveryId: string) {
  return deliveryRequest<ProjectDeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}`)
}
export function loadProjectDeliveryHistory(projectId: string) {
  return deliveryRequest<ProjectDeliverySummary[]>(`/api/projects/${encodeURIComponent(projectId)}/deliveries`)
}

/** Every customer output uses a fixed version; selected history is never regenerated. */
export async function prepareProjectDeliveryOutput(projectId: string, current?: ProjectDeliverySnapshot, fetcher: typeof fetch = fetch): Promise<ProjectDeliverySnapshot> {
  const snapshot = current?.version ? current : await deliveryRequest<ProjectDeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/deliveries`, { method: "POST" }, fetcher)
  if (!snapshot?.id || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1 || snapshot.project?.id !== projectId) {
    throw new Error("交付版本的项目或版本信息不完整，请重新生成。")
  }
  return snapshot
}

/** A quote-only PDF is allowed only when the visible project explicitly has no plan. */
export async function prepareQuoteExportSource(input: {
  projectId: string
  snapshot: SavedQuoteExportSnapshot
  fetcher?: typeof fetch
}): Promise<{ kind: "delivery"; delivery: ProjectDeliverySnapshot } | { kind: "quote"; snapshot: SavedQuoteExportSnapshot }> {
  const hasPointSource = input.snapshot.items.some((item) => item.pointMapProjectId || item.pointIds?.length)
  try {
    const delivery = await prepareProjectDeliveryOutput(input.projectId, undefined, input.fetcher)
    if (!delivery.quote) throw new Error("交付版本没有对应的已保存报价，请核对后重试。")
    return { kind: "delivery", delivery }
  } catch (error) {
    if (error instanceof DeliveryRequestError && error.status === 409 && error.code === "DELIVERY_PLAN_REQUIRED") {
      if (!hasPointSource) return { kind: "quote", snapshot: input.snapshot }
      throw new Error("报价仍关联点位来源，但对应方案不存在，请先核对来源再导出。")
    }
    throw error
  }
}
