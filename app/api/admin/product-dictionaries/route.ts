import { NextRequest, NextResponse } from "next/server"

import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import {
  DictionaryError,
  createDictionaryEntry,
  listProductDictionaries,
  updateDictionaryEntry,
  type DictionaryKind,
} from "@/lib/product-dictionaries"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KINDS: DictionaryKind[] = ["brand", "series", "model"]

function parseKind(value: unknown): DictionaryKind {
  const kind = String(value ?? "") as DictionaryKind
  if (!KINDS.includes(kind)) throw new DictionaryError("kind 只能是 brand / series / model")
  return kind
}

function errorResponse(error: unknown) {
  // 字典自己的错误说人话；其它异常交给统一映射（鉴权失败等要返回标准形状）。
  if (error instanceof DictionaryError) {
    return NextResponse.json({ error: "DICTIONARY_ERROR", message: error.message }, { status: error.status })
  }
  return adminApiErrorResponse(error)
}

/** 读取品牌/系列/型号字典（含已停用的，下拉框自己过滤）。 */
export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json({ dictionaries: await listProductDictionaries() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

/** 新增一条：品牌 / 系列（需品牌）/ 型号（需品牌，系列可选）。 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin()
    const body = await request.json().catch(() => ({}))
    const entry = await createDictionaryEntry({
      brand: body?.brand,
      kind: parseKind(body?.kind),
      name: body?.name,
      series: body?.series,
    })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

/** 改名或停用/启用。停用而不是删除：已经被产品引用的值不能凭空消失。 */
export async function PATCH(request: NextRequest) {
  try {
    await requireSuperAdmin()
    const body = await request.json().catch(() => ({}))
    const entry = await updateDictionaryEntry({
      id: body?.id,
      isActive: body?.isActive,
      kind: parseKind(body?.kind),
      name: body?.name,
    })
    return NextResponse.json({ entry })
  } catch (error) {
    return errorResponse(error)
  }
}
