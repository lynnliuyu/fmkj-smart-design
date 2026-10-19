"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PointMapNode } from "@/lib/point-map-plan"
import { createCurtainMaterialTemplate, expandPointMaterials, type PointMaterial } from "@/lib/point-materials"
import type { SelectionProduct } from "@/lib/product-selection"

type Props = { point: PointMapNode; products: SelectionProduct[]; readOnly?: boolean; onPatch: (patch: Partial<PointMapNode>) => void }
const roleNames = { track: "轨道", accessory: "配件", service: "服务" } as const

export function PointMaterialsEditor({ point, products, readOnly = false, onPatch }: Props) {
  const materials = point.materials ?? []
  const diagnostics = readOnly ? [] : expandPointMaterials(point, products).diagnostics
  const candidates = products.filter((product) => product.catalogKind === "sku")
  function patchMaterial(id: string, patch: Partial<PointMaterial>) {
    onPatch({ materials: materials.map((material) => material.id === id ? { ...material, ...patch } : material) })
  }
  function addMaterial() {
    onPatch({ materials: [...materials, { id: crypto.randomUUID(), productId: "", role: "accessory", quantity: null, unit: "", required: true, included: false }] })
  }
  return <div className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label>配套用料</Label>
      <div className="flex gap-2">
        {materials.length === 0 && ["curtain-motor", "curtain-kit"].includes(point.deviceTypeId ?? "") ? <Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() => onPatch({ materials: createCurtainMaterialTemplate(crypto.randomUUID()) })}>添加窗帘轨道</Button> : null}
        <Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={addMaterial}><Plus className="size-3" />添加用料</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{readOnly ? "历史用料按保存的型号与计量快照展示。" : "电机和轨道共用点位图标。按实测填写米数；套装已含的材料不另计费用。"}</p>
    {materials.map((material, index) => <div key={material.id} className="space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{index + 1}</span>
        <Select value={material.role} disabled={readOnly} onValueChange={(role) => patchMaterial(material.id, { role: role as PointMaterial["role"] })}>
          <SelectTrigger aria-label={`用料 ${index + 1} 类型`} className="w-28"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleNames).map(([role, name]) => <SelectItem key={role} value={role}>{name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="icon" variant="ghost" disabled={readOnly} aria-label={`删除用料 ${index + 1}`} onClick={() => onPatch({ materials: materials.filter((entry) => entry.id !== material.id) })}><Trash2 className="size-3" /></Button>
      </div>
      {readOnly ? <div className="rounded-md bg-muted/40 px-2 py-1 text-sm">{material.selection ? `${material.selection.name} · ${material.selection.sku} · 已存规格 r${material.selection.mappingRevision}` : material.included ? "套装已含材料" : "旧版用料（缺少型号快照）"}</div> : <Select value={material.productId || "none"} disabled={readOnly} onValueChange={(productId) => patchMaterial(material.id, { productId: productId === "none" ? "" : productId, selection: undefined, unit: products.find((product) => product.id === productId)?.unit ?? material.unit })}>
        <SelectTrigger aria-label={`用料 ${index + 1} 型号`}><SelectValue placeholder="选择具体 SKU" /></SelectTrigger><SelectContent><SelectItem value="none">待选择具体 SKU</SelectItem>{candidates.map((product) => <SelectItem key={product.id} value={product.id}>{product.name} · {product.sku}{product.selectionStatus !== "verified" ? " · 参数待核" : ""}</SelectItem>)}</SelectContent>
      </Select>}
      {!readOnly && material.selection ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>已存：{material.selection.name} · {material.selection.sku} · r{material.selection.mappingRevision}{material.selection.mappingRevision !== (products.find((product) => product.id === material.productId)?.mappingRevision ?? 1) ? " · 型号资料已更新" : ""}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => patchMaterial(material.id, { selection: undefined })}>核对后重新选择</Button>
      </div> : null}
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label={`用料 ${index + 1} 数量`} type="number" step="any" min="0" placeholder={material.role === "track" ? "待测长度" : "待确认数量"} value={material.quantity ?? ""} disabled={readOnly} onChange={(event) => patchMaterial(material.id, { quantity: event.target.value === "" ? null : Number(event.target.value) })} />
        <Input aria-label={`用料 ${index + 1} 单位`} value={material.unit} placeholder="单位" disabled={readOnly} onChange={(event) => patchMaterial(material.id, { unit: event.target.value })} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2"><Checkbox checked={material.required} disabled={readOnly} onCheckedChange={(checked) => patchMaterial(material.id, { required: checked === true })} />必配</label>
        <label className="flex items-center gap-2"><Checkbox checked={material.included} disabled={readOnly} onCheckedChange={(checked) => patchMaterial(material.id, { included: checked === true })} />套装已含（不另计费用）</label>
      </div>
    </div>)}
    {diagnostics.length ? <ul className="space-y-1 text-xs text-muted-foreground">{diagnostics.map((issue, index) => <li key={`${issue.materialId}-${issue.code}-${index}`}>{issue.message}{issue.blocking ? " · 采购待完成" : ""}</li>)}</ul> : materials.length === 0 ? <p className="text-xs text-muted-foreground">尚无配套用料。</p> : null}
  </div>
}
