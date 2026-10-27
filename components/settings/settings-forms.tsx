"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import {
  BellRing,
  Camera,
  CreditCard,
  Save,
  User,
} from "lucide-react"
import { toast } from "sonner"

import { getInitials, notifyAccountProfileUpdated, useAccountProfile } from "@/components/account/use-account-profile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function ProfileSettingsForm() {
  const { profile, setProfile } = useAccountProfile()
  const [name, setName] = useState(profile.name)
  const [companyName, setCompanyName] = useState(profile.companyName ?? "")
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "")
  const [companyAvatarUrl, setCompanyAvatarUrl] = useState(profile.companyAvatarUrl ?? "")
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<"avatar" | "company_logo" | null>(null)
  const canManageCompany = profile.isSuperAdmin || profile.permissions.includes("enterprise.manage_members")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setName(profile.name)
      setCompanyName(profile.companyName ?? "")
      setAvatarUrl(profile.avatarUrl ?? "")
      setCompanyAvatarUrl(profile.companyAvatarUrl ?? "")
    }, 0)

    return () => window.clearTimeout(timer)
  }, [profile])

  async function uploadImage(file: File | null, kind: "avatar" | "company_logo") {
    if (!file || (kind === "company_logo" && !canManageCompany)) return
    setMessage("")
    setUploading(kind)

    const formData = new FormData()
    formData.set("file", file)
    formData.set("kind", kind)
    formData.set("entityId", profile.companyId || "current")

    const response = await fetch("/api/upload", {
      body: formData,
      method: "POST",
    })
    const data = (await response.json()) as { data?: { url: string }; error?: string }
    setUploading(null)

    if (!response.ok || !data.data?.url) {
      setMessage(data.error ?? "上传失败")
      return
    }

    if (kind === "avatar") setAvatarUrl(data.data.url)
    else setCompanyAvatarUrl(data.data.url)
  }

  async function saveProfile() {
    setSaving(true)
    setMessage("")
    const response = await fetch("/api/account/profile", {
      body: JSON.stringify({
        avatarUrl,
        name,
        ...(canManageCompany ? { companyAvatarUrl, companyName } : {}),
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
    const data = (await response.json()) as { profile?: typeof profile; error?: string }
    setSaving(false)

    if (!response.ok || !data.profile) {
      setMessage(data.error ?? "保存失败")
      return
    }

    setProfile(data.profile)
    notifyAccountProfileUpdated(data.profile)
    setMessage("资料已更新")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="size-5" />
          资料
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-2xl gap-6" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-4 sm:grid-cols-2">
            <AvatarUpload
              label="用户头像"
              name={name}
              url={avatarUrl}
              uploading={uploading === "avatar"}
              onUpload={(file) => void uploadImage(file, "avatar")}
            />
            {canManageCompany ? <AvatarUpload
              label="左上角头像"
              name={companyName || name}
              url={companyAvatarUrl}
              uploading={uploading === "company_logo"}
              onUpload={(file) => void uploadImage(file, "company_logo")}
            /> : null}
          </div>
          <Field label="显示名称" htmlFor="profile-name">
            <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          {canManageCompany ? <Field label="公司名称" htmlFor="profile-company">
            <Input id="profile-company" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </Field> : null}
          {message ? <div className="text-sm text-muted-foreground">{message}</div> : null}
          <Button type="button" className="w-fit" disabled={saving || uploading !== null} onClick={() => void saveProfile()}>
            <Save className="size-4" />
            {saving ? "保存中" : "保存资料"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function AccountSettingsForm() {
  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    toast.success("账户设置已更新")
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5" />
            账户信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-2xl gap-6" onSubmit={saveSettings}>
            <Field label="姓名" htmlFor="account-name">
              <Input id="account-name" defaultValue="Lynn Liu" />
            </Field>
            <Field label="默认角色" htmlFor="account-role">
              <Select defaultValue="owner">
                <SelectTrigger id="account-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">经理-老板</SelectItem>
                  <SelectItem value="sales">销售</SelectItem>
                  <SelectItem value="engineer">工程师</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="系统语言" htmlFor="account-language">
              <Select defaultValue="zh-Hans">
                <SelectTrigger id="account-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-Hans">简体中文</SelectItem>
                  <SelectItem value="zh-Hant">繁体中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="时区" htmlFor="account-timezone">
              <Select defaultValue="Asia/Hong_Kong">
                <SelectTrigger id="account-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Hong_Kong">
                    Asia/Hong_Kong
                  </SelectItem>
                  <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <SaveButton>更新账户</SaveButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账户状态</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusLine label="套餐" value="Team" />
          <StatusLine label="双重验证" value="未开启" muted />
          <StatusLine label="席位" value="5 / 20" />
          <StatusLine label="项目" value="3 个进行中" />
        </CardContent>
      </Card>
    </div>
  )
}

export function NotificationsSettingsForm() {
  function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    toast.success("通知设置已更新")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-5" />
          通知设置
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-3xl gap-8" onSubmit={saveSettings}>
          <div className="grid gap-3">
            <Label>站内通知范围</Label>
            <RadioGroup defaultValue="important" className="grid gap-3">
              <ChoiceCard id="notify-all" value="all" title="所有消息" />
              <ChoiceCard id="notify-important" value="important" title="重要消息" />
              <ChoiceCard id="notify-none" value="none" title="不提醒" />
            </RadioGroup>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium">邮件通知</h3>
            <SwitchLine label="项目进度邮件" checked />
            <SwitchLine label="报价与合同邮件" checked />
            <SwitchLine label="售后服务邮件" />
            <SwitchLine label="安全邮件" checked disabled />
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-4">
            <Checkbox id="mobile-notify" defaultChecked />
            <Label htmlFor="mobile-notify">移动端使用独立通知策略</Label>
          </div>

          <SaveButton>更新通知</SaveButton>
        </form>
      </CardContent>
    </Card>
  )
}

function AvatarUpload({
  label,
  name,
  onUpload,
  uploading,
  url,
}: {
  label: string
  name: string
  onUpload: (file: File | null) => void
  uploading: boolean
  url: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-muted/40 p-4">
      <Avatar className="size-14">
        <AvatarImage src={url || undefined} alt={name} />
        <AvatarFallback>{getInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        <Button asChild type="button" variant="outline" size="sm" className="w-fit" disabled={uploading}>
          <label>
            <Camera className="size-4" />
            {uploading ? "上传中" : "上传图片"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => onUpload(event.target.files?.[0] ?? null)}
            />
          </label>
        </Button>
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function SaveButton({ children }: { children: ReactNode }) {
  return (
    <Button type="submit" className="w-fit">
      <Save className="size-4" />
      {children}
    </Button>
  )
}

function StatusLine({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "font-medium"}>
        {value}
      </span>
    </div>
  )
}

function SwitchLine({
  label,
  checked,
  disabled,
}: {
  label: string
  checked?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 px-4 py-3">
      <div className="font-medium">{label}</div>
      <Switch defaultChecked={checked} disabled={disabled} />
    </div>
  )
}

function ChoiceCard({
  id,
  value,
  title,
  icon,
}: {
  id: string
  value: string
  title: string
  icon?: ReactNode
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 hover:bg-muted/40"
    >
      <RadioGroupItem id={id} value={value} />
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
    </label>
  )
}
