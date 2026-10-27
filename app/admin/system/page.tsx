import { getDeployStatus } from "@/lib/deploy-status"
import { readUpdateStatus } from "@/lib/deploy-update"
import { getDatabaseStatus, getEnvironmentStatus, getServerStatus } from "@/lib/platform-health"
import { listPlatformSettings } from "@/lib/platform-settings"

import { SystemHealthView } from "../_components/operations-views"

export default async function AdminSystemPage() {
  const [server, database, settings, deploy, update] = await Promise.all([
    getServerStatus(),
    getDatabaseStatus(),
    listPlatformSettings(),
    getDeployStatus(),
    readUpdateStatus(),
  ])

  return (
    <SystemHealthView
      database={database}
      deploy={deploy}
      environment={getEnvironmentStatus()}
      settings={settings}
      server={server}
      update={update}
    />
  )
}
