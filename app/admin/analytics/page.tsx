import { getAccessAnalytics } from "@/lib/platform-health"

import { AnalyticsView } from "./analytics-view"

export default async function AdminAnalyticsPage() {
  return <AnalyticsView analytics={await getAccessAnalytics()} />
}
