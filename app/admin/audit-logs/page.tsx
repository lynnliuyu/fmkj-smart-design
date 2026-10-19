import { listAuditLogs } from "@/lib/platform-health"

import { AuditLogsView } from "./audit-logs-view"

export default async function AdminAuditLogsPage() {
  return <AuditLogsView logs={await listAuditLogs()} />
}
