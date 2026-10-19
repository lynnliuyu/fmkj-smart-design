"use client"

import Image from "next/image"
import { Boxes, HelpCircle, LayoutGrid } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pointIconDefinitions, pointIconGroups } from "@/lib/point-icons"
import {
  classifyProductForPointMap,
  matchesProductPointFilter,
  POINT_MATERIAL_CATEGORY,
  productPointCategories,
  UNKNOWN_POINT_ICON,
  type PointClassifiableProduct,
  type ProductPointFilter,
} from "@/lib/product-point-classification"

export function ProductPointFilters({ products, value, onChange }: {
  products: readonly PointClassifiableProduct[]
  value: ProductPointFilter
  onChange: (filter: ProductPointFilter) => void
}) {
  const classifications = products.map(classifyProductForPointMap)
  const categoryProducts = products.filter((product) => matchesProductPointFilter(product, { category: value.category, iconId: "all" }))
  const categoryClassifications = categoryProducts.map(classifyProductForPointMap)
  const unknownCount = categoryClassifications.filter((item) => item.iconId === UNKNOWN_POINT_ICON).length
  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium"><LayoutGrid className="size-4" />点位图分类</p>
        <p className="text-xs text-muted-foreground">按点位类别和设备图标查找产品，规格未明确的产品保留为图标待定。</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="点位图类别筛选">
        <Button type="button" size="sm" variant={value.category === "all" ? "default" : "outline"} aria-pressed={value.category === "all"} onClick={() => onChange({ category: "all", iconId: "all" })}>全部类别 <span className="tabular-nums">{products.length}</span></Button>
        {productPointCategories.map((category) => {
          const count = classifications.filter((item) => item.category === category).length
          const icon = pointIconGroups.find((group) => group.category === category)?.icons[0]
          return <Button key={category} type="button" size="sm" variant={value.category === category ? "default" : "outline"} aria-pressed={value.category === category} disabled={!count && value.category !== category} onClick={() => onChange({ category, iconId: "all" })}>
            {icon ? <Image src={icon.icon} width={20} height={20} alt="" className="size-5 rounded bg-white" /> : category === POINT_MATERIAL_CATEGORY ? <Boxes className="size-4" /> : <HelpCircle className="size-4" />}
            {category} <span className="tabular-nums">{count}</span>
          </Button>
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="点位图设备图标筛选">
        <span className="mr-1 text-xs font-medium text-muted-foreground">设备图标</span>
        <Button type="button" size="sm" variant={value.iconId === "all" ? "secondary" : "ghost"} aria-pressed={value.iconId === "all"} onClick={() => onChange({ ...value, iconId: "all" })}>全部图标 {categoryProducts.length}</Button>
        {pointIconDefinitions.map((icon) => {
          const count = categoryClassifications.filter((item) => item.iconId === icon.id).length
          if (!count && value.iconId !== icon.id) return null
          return <Button key={icon.id} type="button" size="sm" variant={value.iconId === icon.id ? "secondary" : "outline"} aria-pressed={value.iconId === icon.id} onClick={() => onChange({ ...value, iconId: icon.id })}>
            <Image src={icon.icon} width={22} height={22} alt="" className="size-5 rounded bg-white" />{icon.name} <span className="tabular-nums">{count}</span>
          </Button>
        })}
        {(unknownCount > 0 || value.iconId === UNKNOWN_POINT_ICON) && <Button type="button" size="sm" variant={value.iconId === UNKNOWN_POINT_ICON ? "secondary" : "outline"} aria-pressed={value.iconId === UNKNOWN_POINT_ICON} onClick={() => onChange({ ...value, iconId: UNKNOWN_POINT_ICON })}><HelpCircle className="size-4" />图标待定 {unknownCount}</Button>}
      </div>
    </div>
  )
}

export function ProductPointBadge({ product }: { product: PointClassifiableProduct }) {
  const { icon, label } = classifyProductForPointMap(product)
  return <span className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
    {icon ? <Image src={icon.icon} width={22} height={22} alt="" className="size-5 shrink-0" /> : <HelpCircle className="size-4 shrink-0" />}
    <span>{label}</span>
  </span>
}
