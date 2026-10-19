import {
  listPlatformOrganizations,
  listPlatformPlans,
} from "@/lib/account-system/platform-admin-service"

import { OrganizationManagement } from "./organization-management"

export default async function AdminOrganizationsPage() {
  const [organizations, plans] = await Promise.all([
    listPlatformOrganizations(),
    listPlatformPlans(),
  ])

  return (
    <OrganizationManagement
      initialOrganizations={organizations}
      plans={plans.filter((plan) => plan.planCode.startsWith("ENTERPRISE"))}
    />
  )
}
