"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ProductDictionaries } from "@/lib/product-dictionary-types"

/**
 * 品牌 / 系列 / 型号 字典的维护入口。
 *
 * 为什么要有这个界面：这三项现在是受控字段（导入时严格校验），运营方得能自己加品牌、
 * 加系列型号，而不是每次都找人改代码。停用而不是删除——已经被产品引用的值不能凭空消失。
 */
export function ProductDictionariesDialog({ initial }: { initial: ProductDictionaries }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [dictionaries, setDictionaries] = React.useState(initial)
  const [message, setMessage] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [brandName, setBrandName] = React.useState("")
  const [seriesName, setSeriesName] = React.useState("")
  const [seriesBrand, setSeriesBrand] = React.useState("")
  const [modelName, setModelName] = React.useState("")
  const [modelBrand, setModelBrand] = React.useState("")

  async function call(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/product-dictionaries", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(String(data?.message ?? data?.error ?? "操作失败"))
        return false
      }
      const refreshed = await fetch("/api/admin/product-dictionaries", { cache: "no-store" })
      if (refreshed.ok) setDictionaries((await refreshed.json()).dictionaries)
      // 产品表单的字典是服务端传下来的，刷新页面让它拿到最新值。
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function addBrand() {
    if (!brandName.trim()) return setMessage("请填品牌名")
    if (await call("POST", { kind: "brand", name: brandName })) {
      setBrandName("")
      setMessage(`品牌「${brandName.trim()}」已加入字典`)
    }
  }

  async function addSeries() {
    if (!seriesBrand) return setMessage("请先选品牌")
    if (!seriesName.trim()) return setMessage("请填系列名")
    if (await call("POST", { brand: seriesBrand, kind: "series", name: seriesName })) {
      setMessage(`系列「${seriesName.trim()}」已加入「${seriesBrand}」`)
      setSeriesName("")
    }
  }

  async function addModel() {
    if (!modelBrand) return setMessage("请先选品牌")
    if (!modelName.trim()) return setMessage("请填型号")
    if (await call("POST", { brand: modelBrand, kind: "model", name: modelName })) {
      setMessage(`型号「${modelName.trim()}」已加入「${modelBrand}」`)
      setModelName("")
    }
  }

  const activeBrands = dictionaries.brands.filter((entry) => entry.isActive)

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline">品牌/型号字典</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>品牌 / 系列 / 型号字典</DialogTitle>
          <DialogDescription>
            品牌、系列、型号只能从字典里选；导入表格时也会按这份字典校验。停用的条目不再出现在下拉里，
            但已经用了它的产品不受影响。
          </DialogDescription>
        </DialogHeader>

        {message ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{message}</p> : null}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">品牌（{dictionaries.brands.length}）</h3>
          <div className="flex gap-2">
            <Input placeholder="新增品牌，例如 Aqara" value={brandName} onChange={(event) => setBrandName(event.target.value)} />
            <Button disabled={busy} onClick={() => void addBrand()} type="button">
              <Plus /> 加入
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {dictionaries.brands.map((entry) => (
              <span className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs" key={entry.id}>
                {entry.name}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => void call("PATCH", { id: entry.id, isActive: !entry.isActive, kind: "brand" })}
                  type="button"
                >
                  {entry.isActive ? "停用" : "启用"}
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">系列（{dictionaries.series.length}）</h3>
          <div className="flex flex-wrap gap-2">
            <Select value={seriesBrand} onValueChange={setSeriesBrand}>
              <SelectTrigger className="w-40"><SelectValue placeholder="选择品牌" /></SelectTrigger>
              <SelectContent>
                {activeBrands.map((entry) => <SelectItem key={entry.id} value={entry.name}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="flex-1" placeholder="新增系列，例如 D1" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} />
            <Button disabled={busy} onClick={() => void addSeries()} type="button"><Plus /> 加入</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {dictionaries.series.map((entry) => (
              <span className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs" key={entry.id}>
                {entry.brandName} · {entry.name}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => void call("PATCH", { id: entry.id, isActive: !entry.isActive, kind: "series" })}
                  type="button"
                >
                  {entry.isActive ? "停用" : "启用"}
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">型号（{dictionaries.models.length}）</h3>
          <div className="flex flex-wrap gap-2">
            <Select value={modelBrand} onValueChange={setModelBrand}>
              <SelectTrigger className="w-40"><SelectValue placeholder="选择品牌" /></SelectTrigger>
              <SelectContent>
                {activeBrands.map((entry) => <SelectItem key={entry.id} value={entry.name}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="flex-1" placeholder="新增型号，例如 QBKG28LM" value={modelName} onChange={(event) => setModelName(event.target.value)} />
            <Button disabled={busy} onClick={() => void addModel()} type="button"><Plus /> 加入</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {dictionaries.models.map((entry) => (
              <span className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs" key={entry.id}>
                {entry.brandName} · {entry.name}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => void call("PATCH", { id: entry.id, isActive: !entry.isActive, kind: "model" })}
                  type="button"
                >
                  {entry.isActive ? "停用" : "启用"}
                </button>
              </span>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
