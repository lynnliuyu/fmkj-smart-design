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
  const [uploading, setUploading] = React.useState("")
  const logoInput = React.useRef<HTMLInputElement>(null)
  const uploadTarget = React.useRef<PlatformSettingKey | null>(null)

  /** 报价单上的 logo：客户选一张图就传上去，把地址填进配置项，不用自己拼 URL。 */
  async function uploadLogo(file: File) {
    const target = uploadTarget.current ?? "BRAND_LOGO_URL"
    setUploading(target)
    try {
      const body = new FormData()
      body.append("kind", "company_logo")
      body.append("file", file)
      const response = await fetch("/api/upload", { body, method: "POST" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.error ?? "图片上传失败")
        return
      }
      setValues((current) => ({ ...current, [target]: data.url ?? "" }))
      toast.success("图片已上传，记得点下面的「保存配置」")
    } catch {
      toast.error("图片上传失败，请稍后重试")
    } finally {
      setUploading("")
    }
  }

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
              <label className="grid gap-2 rounded-md bg-muted/50 p-3" key={setting.key}>
                <span className="text-sm font-medium">{setting.label}</span>
                {setting.type === "textarea" ? (
                  <Textarea
                    onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))}
                    placeholder={setting.placeholder}
                    value={values[setting.key] ?? ""}
                  />
                ) : setting.type === "image" ? (
                  <div className="grid gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))}
                        placeholder={setting.placeholder}
                        value={values[setting.key] ?? ""}
                      />
                      <Button
                        disabled={uploading === setting.key}
                        onClick={() => {
                          uploadTarget.current = setting.key
                          logoInput.current?.click()
                        }}
                        type="button"
                        variant="outline"
                      >
                        {uploading === setting.key ? "上传中" : "上传图片"}
                      </Button>
                      <input
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void uploadLogo(file)
                          event.target.value = ""
                        }}
                        ref={logoInput}
                        type="file"
                      />
                    </div>
                    {values[setting.key] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="当前图片" className="h-10 w-auto rounded border bg-white object-contain p-1" src={values[setting.key]} />
                    ) : null}
                  </div>
                ) : (
                  <Input
                    onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))}
                    placeholder={setting.placeholder}
                    type={setting.type === "email" || setting.type === "url" ? setting.type : "text"}
                    value={values[setting.key] ?? ""}
                  />
                )}
                <span className="text-xs leading-5 text-muted-foreground">{setting.description}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{setting.key}</span>
              </label>
            ))}
          </div>

          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
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
