import { NextRequest, NextResponse } from "next/server"
import { adminApiErrorResponse } from "@/lib/admin-api"
import { requireSuperAdmin } from "@/lib/admin-auth"
import { getPool } from "@/lib/server-db"
import { freezeProductQuoteSnapshots } from "@/lib/product-admin-service"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const account = await requireSuperAdmin()
    const { id } = await context.params
    const payload = await request.json()
    const image = String(payload.image ?? "").trim()

    if (!id || !image) {
      return NextResponse.json({ error: "PRODUCT_IMAGE_REQUIRED" }, { status: 400 })
    }

    const client = await getPool().connect()
    let result
    try {
      await client.query("begin")
      await client.query("select id from products where id=$1::uuid for update", [id])
      await freezeProductQuoteSnapshots(client, id)
      result = await client.query(
      `
      update products
      set image = $2,
          updated_by = $3,
          updated_at = now()
      where id = $1::uuid
        and deleted_at is null
      returning id::text, image
      `,
      [id, image, account.user.userId]
      )
      await client.query("commit")
    } catch (error) { await client.query("rollback"); throw error } finally { client.release() }

    if (!result.rows[0]) {
      return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 })
    }

    return NextResponse.json({ data: result.rows[0], source: "postgres" })
  } catch (error) {
    try {
      return adminApiErrorResponse(error)
    } catch (unhandled) {
      return NextResponse.json(
        { error: unhandled instanceof Error ? unhandled.message : "PRODUCT_IMAGE_UPDATE_FAILED" },
        { status: 500 }
      )
    }
  }
}

