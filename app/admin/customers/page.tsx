import {
  listPlatformCustomers,
  listPlatformPlans,
} from "@/lib/account-system/platform-admin-service"

import { CustomerManagement } from "./customer-management"

export default async function AdminCustomersPage() {
  const [customers, plans] = await Promise.all([listPlatformCustomers(), listPlatformPlans()])

  return <CustomerManagement initialCustomers={customers} plans={plans} />
}
