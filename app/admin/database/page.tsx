import { getDatabaseStatus } from "@/lib/platform-health"

import { DatabaseView } from "../_components/operations-views"

export default async function AdminDatabasePage() {
  return <DatabaseView database={await getDatabaseStatus()} />
}
