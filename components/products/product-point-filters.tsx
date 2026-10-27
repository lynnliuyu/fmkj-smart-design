"use client"

import Image from "next/image"
import { Boxes, HelpCircle } from "lucide-react"

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
import { cn } from "@/lib/utils"

/** 当前生效的点位图筛选名称，给状态行上的可移除标签用。 */
export function pointFilterLabel(value: ProductPointFilter) {
  if (value.iconId !== "all") {
    return (
      pointIconDefinitions.find((icon) => icon.id === value.iconId)?.name ??
      "设备图标"
    )
  }

  return value.category === "all" ? "" : value.category
}

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
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-muted-foreground">点位图分类</div>
        <p className="text-xs text-muted-foreground">按点位类别和设备图标查找产品，规格未明确的产品保留为图标待定。</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="点位图类别筛选">
          {productPointCategories.map((category) => {
            const count = classifications.filter((item) => item.category === category).length
            const icon = pointIconGroups.find((group) => group.category === category)?.icons[0]
            const active = value.category === category
            if (!count && !active) return null
            return <Button key={category} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => onChange(active ? { category: "all", iconId: "all" } : { category, iconId: "all" })}>
              {icon ? <Image src={icon.icon} width={20} height={20} alt="" className="size-5 rounded bg-white" /> : category === POINT_MATERIAL_CATEGORY ? <Boxes className="size-4" /> : <HelpCircle className="size-4" />}
              {category}{count > 0 ? <span className="tabular-nums">{count}</span> : null}
            </Button>
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-muted-foreground">设备图标</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="点位图设备图标筛选">
          {pointIconDefinitions.map((icon) => {
            const count = categoryClassifications.filter((item) => item.iconId === icon.id).length
            const active = value.iconId === icon.id
            if (!count && !active) return null
            return <Button key={icon.id} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => onChange(active ? { ...value, iconId: "all" } : { ...value, iconId: icon.id })}>
              <Image src={icon.icon} width={22} height={22} alt="" className="size-5 rounded bg-white" />{icon.name}{count > 0 ? <span className="tabular-nums">{count}</span> : null}
            </Button>
          })}
          {unknownCount > 0 || value.iconId === UNKNOWN_POINT_ICON ? <Button type="button" size="sm" variant={value.iconId === UNKNOWN_POINT_ICON ? "default" : "outline"} aria-pressed={value.iconId === UNKNOWN_POINT_ICON} onClick={() => onChange({ ...value, iconId: value.iconId === UNKNOWN_POINT_ICON ? "all" : UNKNOWN_POINT_ICON })}><HelpCircle className="size-4" />图标待定{unknownCount > 0 ? <span className="tabular-nums">{unknownCount}</span> : null}</Button> : null}
        </div>
      </div>
    </div>
  )
}

export function ProductPointBadge({ product }: { product: PointClassifiableProduct }) {
  const { icon, label } = classifyProductForPointMap(product)
  return <span className={cn("inline-flex max-w-full items-center gap-1.5 text-xs", icon ? "text-muted-foreground" : "font-medium text-foreground")}>
    {icon ? <Image src={icon.icon} width={22} height={22} alt="" className="size-5 shrink-0" /> : <HelpCircle className="size-4 shrink-0 text-warning" />}
    <span>{label}</span>
  </span>
}
