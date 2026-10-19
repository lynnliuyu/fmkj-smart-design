import { ProfileSettingsForm } from "@/components/settings/settings-forms"
import { SettingsShell } from "@/components/settings/settings-shell"

export default function SettingsPage() {
  return (
    <SettingsShell>
      <ProfileSettingsForm />
    </SettingsShell>
  )
}
