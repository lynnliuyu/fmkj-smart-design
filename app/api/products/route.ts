import { NextRequest, NextResponse } from "next/server"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { fallbackProducts } from "@/lib/fallback-products"
import {
  createAdminProduct,
  productSelectionMutationFields,
  productValidationErrorResponse,
  type ProductModerationStatus,
} from "@/lib/product-admin-service"
import { productSelectionWithDefaults, type ProductSelectionFields } from "@/lib/product-selection"
import { normalizeProductCategory } from "@/lib/product-categories"
import { getCurrentAccountContext } from "@/lib/account-context"
import { canViewProductCost, stripProductCost } from "@/lib/product-cost"
import { getPool, hasDatabaseUrl } from "@/lib/server-db"
import { loadProductVisualAssets } from "@/lib/product-visual-assets-service"

type ApiProduct = Partial<ProductSelectionFields> & {
  id: string
  name: string
  brand?: string | null
  platform?: string | null
  category?: string | null
  sku: string
  unit: string
  price: number
  cost?: number | null
  stock?: number | null
  image?: string | null
  description?: string | null
  tags?: string[]
  channels?: string[]
  status: ProductModerationStatus
}

type ProductsResponse = {
  data?: ApiProduct[]
  pagination?: {
    total?: number
  }
}

export async function GET() {
  // 成本只给经营者看：企业里的编辑/查看者拿不到，界面上显示「仅管理者可见」。
  // 报价保存时服务端会用目录成本兜底，所以不影响毛利统计。
  const showCost = canViewProductCost(await getCurrentAccountContext())
  if (hasDatabaseUrl()) {
    return getProductsFromPostgres(showCost)
  }

  return getProductsFromHttpApi(showCost)
}

/** 统一的出参形状：先补默认值，再按权限决定要不要带成本。 */
function shapeProduct(product: ApiProduct, showCost: boolean) {
  const normalized = normalizeApiProduct(product)
  return showCost ? normalized : stripProductCost(normalized)
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireSuperAdmin()
    const body = await request.json()
    const product = await createAdminProduct({
      actorUserId: context.user.userId,
      ...productSelectionMutationFields(body),
      selectionStatus: "pending",
      pricingStatus: "pending",
      brand: optionalString(body.brand),
      category: optionalString(body.category),
      channels: Array.isArray(body.channels) ? body.channels.map(String) : [],
      cost: Number(body.cost ?? 0),
      description: optionalString(body.description),
      image: optionalString(body.image),
      name: String(body.name ?? ""),
      platform: optionalString(body.platform),
      series: optionalString(body.series),
      platforms: Array.isArray(body.platforms) ? body.platforms.map(String) : undefined,
      price: Number(body.price ?? 0),
      sku: String(body.sku ?? ""),
      status: "active",
      stock: Number(body.stock ?? 0),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      unit: String(body.unit ?? "个"),
    })

    return NextResponse.json({ data: normalizeApiProduct(product), source: "postgres" }, { status: 201 })
  } catch (error) {
    try {
      return adminApiErrorResponse(error)
    } catch (unhandled) {
      try {
        return productValidationErrorResponse(unhandled)
      } catch {
        return NextResponse.json(
          { error: unhandled instanceof Error ? unhandled.message : "PRODUCT_CREATE_FAILED" },
          { status: 500 }
        )
      }
    }
  }
}

async function getProductsFromPostgres(showCost: boolean) {
  try {
    const productsTable = quoteIdentifier(process.env.PRODUCTS_TABLE ?? "products")
    const productsLimit = Number(process.env.PRODUCTS_LIMIT ?? 2000)
    const activeProductsWhere = `
      from ${productsTable}
      where deleted_at is null
        and coalesce(status::text, 'active') in ('active', 'approved')
    `
    const [result, totalResult] = await Promise.all([
      getPool().query<ApiProduct>(
        `
      select
        catalog_kind as "catalogKind", device_type_id as "deviceTypeId", parent_product_id::text as "parentProductId",
        manufacturer_model as "manufacturerModel", specs, protocols, capabilities, selection_status as "selectionStatus",
        selection_evidence as "selectionEvidence", pricing_status as "pricingStatus", pricing_evidence as "pricingEvidence",
        mapping_revision as "mappingRevision",
        id::text,
        name,
        brand,
        platform,
        category,
        sku,
        coalesce(unit, '个') as unit,
        coalesce(price, 0)::float8 as price,
        coalesce(cost, 0)::float8 as cost,
        coalesce(stock, 0)::int as stock,
        image,
        description,
        coalesce(to_jsonb(tags), '[]'::jsonb) as tags,
        coalesce(to_jsonb(channels), '[]'::jsonb) as channels,
        coalesce(status, 'active') as status
      ${activeProductsWhere}
      order by name asc
      limit $1
    `,
        [productsLimit]
      ),
      getPool().query<{ count: number }>(
        `select count(*)::int as count ${activeProductsWhere}`
      ),
    ])

    const visuals = await loadProductVisualAssets(getPool(), result.rows.map((product) => product.id))
    return NextResponse.json({
      data: result.rows.map((product) => ({ ...shapeProduct(product, showCost), visualAsset: visuals.get(product.id) ?? null })),
      source: "postgres",
      total: totalResult.rows[0]?.count ?? result.rowCount,
    })
  } catch (error) {
    return fallbackResponse(
      error instanceof Error ? error.message : "POSTGRES_PRODUCTS_UNAVAILABLE",
      "postgres-fallback",
      showCost
    )
  }
}

async function getProductsFromHttpApi(showCost: boolean) {
  const baseUrl =
    process.env.FMKJ_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:4000"
  const token = process.env.FMKJ_API_TOKEN ?? process.env.DEV_AUTH_TOKEN ?? "dev-admin-token-local"

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/products?page_size=500`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })

    if (!response.ok) {
      return fallbackResponse(`PRODUCT_API_${response.status}`, "database-api-fallback", showCost)
    }

    const payload = (await response.json()) as ProductsResponse

    return NextResponse.json({
      data: (payload.data ?? []).map((product) => shapeProduct(product, showCost)),
      source: "database-api",
      total: payload.pagination?.total ?? payload.data?.length ?? 0,
    })
  } catch (error) {
    return fallbackResponse(
      error instanceof Error ? error.message : "PRODUCT_API_UNAVAILABLE",
      "http-api-fallback",
      showCost
    )
  }
}

function quoteIdentifier(identifier: string) {
  return identifier
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".")
}

function fallbackResponse(error: string, source: string, showCost: boolean) {
  return NextResponse.json({
    data: fallbackProducts.map((product) => shapeProduct(product, showCost)),
    error,
    source,
    total: fallbackProducts.length,
  })
}

function normalizeApiProduct(product: ApiProduct): ApiProduct {
  return {
    ...product,
    ...productSelectionWithDefaults(product),
    category: normalizeProductCategory(
      product.category,
      product.name,
      product.brand,
      product.platform,
      product.description,
      product.sku
    ),
  }
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim()
  return text || null
}
