import { AccountTeamSettings } from "@/components/account/account-team-settings"
import { SettingsShell } from "@/components/settings/settings-shell"

export default function AccountSettingsPage() {
  return (
    <SettingsShell>
      <AccountTeamSettings />
    </SettingsShell>
  )
}
