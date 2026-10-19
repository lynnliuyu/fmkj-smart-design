import { getEnvironmentStatus } from "@/lib/platform-health"

import { EnvironmentView } from "../_components/operations-views"

export default function AdminEnvironmentsPage() {
  return <EnvironmentView environment={getEnvironmentStatus()} />
}
