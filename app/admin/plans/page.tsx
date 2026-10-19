import { listPlatformPlans } from "@/lib/account-system/platform-admin-service"

import { PlanManagement } from "./plan-management"

export default async function AdminPlansPage() {
  const plans = await listPlatformPlans()

  return <PlanManagement initialPlans={plans} />
}
