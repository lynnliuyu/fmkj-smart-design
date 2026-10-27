"use client"

import * as React from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import {
  QUICK_MODULES,
  QUICK_PLATFORMS,
  QUICK_TIERS,
  computeModuleQuantity,
  type QuickModule,
  type QuickTier,
} from "@/lib/quick-quote-shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Props = {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickQuoteDialog({ projectId, open, onOpenChange }: Props) {
  const [platform, setPlatform] = React.useState("米家")
  const [tier, setTier] = React.useState<QuickTier>("lite")
  const [bedrooms, setBedrooms] = React.useState(2)
  const [livingRooms, setLivingRooms] = React.useState(1)
  const [modules, setModules] = React.useState<Set<QuickModule>>(
    () => new Set(QUICK_MODULES.map((entry) => entry.key)),
  )
  const [saving, setSaving] = React.useState(false)

  function toggleModule(key: QuickModule) {
    setModules((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function previewSummary(moduleKey: QuickModule) {
    return computeModuleQuantity(moduleKey, tier, bedrooms, livingRooms)
  }

  async function handleSubmit() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/quotes/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          platform,
          tier,
          bedrooms,
          livingRooms,
          modules: Array.from(modules),
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        const message =
          payload.error === "NO_MATCHING_PRODUCTS"
            ? "未匹配到合适的产品，请尝试调整平台或勾选项"
            : payload.error === "PROJECT_NOT_ACCESSIBLE"
              ? "无权访问该项目"
              : `生成失败：${payload.error ?? ""}`
        throw new Error(message)
      }
      toast.success(
        `已生成报价 ${payload.data.quoteNo}，共 ${payload.data.savedItems} 项产品`,
      )
      onOpenChange(false)
      // 让上层组件有机会刷新；这里直接给一个导航占位
      if (typeof window !== "undefined") {
        window.location.href = `/quotes?projectId=${encodeURIComponent(projectId)}`
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>快速报价</DialogTitle>
          <DialogDescription>
            选择智能平台、套餐档次与户型规模，按内置套餐预填报价，已勾选模块默认全部包含，可按需取消。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>智能平台</FieldLabel>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUICK_PLATFORMS.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <FieldSet>
            <FieldLabel>套餐档次</FieldLabel>
            <FieldContent className="grid gap-2 sm:grid-cols-2 pt-1">
              {QUICK_TIERS.map((option) => {
                const active = tier === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTier(option.value)}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border p-3 text-start transition",
                      active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                    <div className="text-xs text-muted-foreground">{option.description}</div>
                  </button>
                )
              })}
            </FieldContent>
          </FieldSet>

          <FieldSet>
            <FieldLabel>户型规模</FieldLabel>
            <FieldDescription>室厅数会按倍表影响每个模块的数量。</FieldDescription>
            <FieldContent className="grid gap-3 sm:grid-cols-2 pt-1">
              <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">卧室（室）</span>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={bedrooms}
                  onChange={(event) => setBedrooms(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}
                  className="h-8 w-24 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">客厅（厅）</span>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={livingRooms}
                  onChange={(event) => setLivingRooms(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}
                  className="h-8 w-24 text-right"
                />
              </label>
            </FieldContent>
          </FieldSet>

          <FieldSet>
            <FieldLabel>包含模块</FieldLabel>
            <FieldDescription>默认全选，按需取消勾选；取消后该模块将不计入报价。</FieldDescription>
            <FieldContent className="grid gap-2 pt-1 sm:grid-cols-2">
              {QUICK_MODULES.map((entry) => {
                const checked = modules.has(entry.key)
                const preview = previewSummary(entry.key)
                return (
                  <label
                    key={entry.key}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2 text-sm transition",
                      checked ? "bg-primary/5" : "border-dashed hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleModule(entry.key)}
                      />
                      <span className="font-medium">{entry.label}</span>
                      <Badge variant="outline" className="font-normal text-xs">
                        {entry.category}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">预计 ×{preview}</span>
                  </label>
                )
              })}
            </FieldContent>
          </FieldSet>

          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            提示：生成的报价草稿将{" "}
            <span className="font-medium text-foreground">覆盖</span>{" "}
            当前项目已存在的报价草稿；保存后可在「方案报价」继续微调数量与单价。
          </div>
        </FieldGroup>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving || modules.size === 0}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            生成报价
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}