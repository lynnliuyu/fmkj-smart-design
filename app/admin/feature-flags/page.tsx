import { listPlatformFeatureFlags } from "@/lib/account-system/platform-admin-service"
import { FeatureFlagManagement } from "./feature-flag-management"

export default async function AdminFeatureFlagsPage() {
  return <FeatureFlagManagement initialFeatureFlags={await listPlatformFeatureFlags()} />
}
