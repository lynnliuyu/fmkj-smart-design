"use client"

import { Save } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { PlatformSetting, PlatformSettingKey } from "@/lib/platform-settings"

export function SystemSettingsPanel({ initialSettings }: { initialSettings: PlatformSetting[] }) {
  const [settings, setSettings] = React.useState(initialSettings)
  const [values, setValues] = React.useState<Record<PlatformSettingKey, string>>(() => valuesFromSettings(initialSettings))
  const [saving, setSaving] = React.useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)

    try {
      const response = await fetch("/api/admin/system/settings", {
        body: JSON.stringify({ values }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error ?? "系统配置保存失败")
        return
      }

      setSettings(data.settings)
      setValues(valuesFromSettings(data.settings))
      toast.success("系统配置已保存")
    } catch {
      toast.error("系统配置保存失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>系统配置</CardTitle>
        <p className="text-sm text-muted-foreground">
          这里保存平台可读取的业务配置。服务器环境变量、DNS、数据库真实连接串仍需在部署平台或服务器中修改。
        </p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            {settings.map((setting) => (
              <label className="grid gap-2 rounded-md border bg-muted/20 p-3" key={setting.key}>
                <span className="text-sm font-medium">{setting.label}</span>
                {setting.type === "textarea" ? (
                  <Textarea
                    onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))}
                    placeholder={setting.placeholder}
                    value={values[setting.key] ?? ""}
                  />
                ) : (
                  <Input
                    onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))}
                    placeholder={setting.placeholder}
                    type={setting.type}
                    value={values[setting.key] ?? ""}
                  />
                )}
                <span className="text-xs leading-5 text-muted-foreground">{setting.description}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{setting.key}</span>
              </label>
            ))}
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            敏感配置不会在页面展示或直接改写：例如 DATABASE_URL、JWT_SECRET、BLOB_READ_WRITE_TOKEN。
            需要轮换密钥或切换数据库时，请先在部署平台完成修改，再回到这里记录说明。
          </div>

          <div className="flex justify-end">
            <Button disabled={saving} type="submit">
              <Save className="size-4" />
              {saving ? "保存中" : "保存配置"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function valuesFromSettings(settings: PlatformSetting[]) {
  return settings.reduce(
    (result, setting) => ({
      ...result,
      [setting.key]: setting.value,
    }),
    {} as Record<PlatformSettingKey, string>
  )
}
