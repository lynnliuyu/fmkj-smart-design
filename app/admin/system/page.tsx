import { getDatabaseStatus, getEnvironmentStatus, getServerStatus } from "@/lib/platform-health"
import { listPlatformSettings } from "@/lib/platform-settings"

import { SystemHealthView } from "../_components/operations-views"

export default async function AdminSystemPage() {
  const [server, database, settings] = await Promise.all([getServerStatus(), getDatabaseStatus(), listPlatformSettings()])

  return <SystemHealthView database={database} environment={getEnvironmentStatus()} settings={settings} server={server} />
}
