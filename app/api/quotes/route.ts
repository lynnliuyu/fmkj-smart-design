import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/server-db";
import { QuoteSaveError, saveQuoteDraft } from "@/lib/quote-save";
import { getCurrentAccountContext } from "@/lib/account-context";
import { PointMapServiceError, assertPermission, assertWritableMembership, requireContext, requireVisibleProject } from "@/lib/point-map-service";
import { pointMapApiErrorResponse } from "@/lib/point-map-api";
import { canViewProductCost, stripSnapshotCosts } from "@/lib/product-cost";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ data: null, source: "postgres" });
    }

    const account = requireContext(await getCurrentAccountContext(), projectId);
    const client = await getPool().connect();
    try { await requireVisibleProject(client, account, projectId); } finally { client.release(); }
    const quote = await getPool().query(
      `
      select
        id::text,
        quote_no as "quoteNo",
        title,
        status::text,
        updated_at as "updatedAt",
        subtotal_amount::float8 as subtotal,
        discount_amount::float8 as discount,
        total_amount::float8 as total,
        coalesce(((case when note ~ '^\\s*\\{' then note::jsonb else '{}'::jsonb end) ->> 'installationFee')::float8, 0) as "installationFee",
        coalesce((case when note ~ '^\\s*\\{' then note::jsonb else '{}'::jsonb end) -> 'rooms', '[]'::jsonb) as rooms
      from quotes
      where deleted_at is null
        and project_id = $1::uuid
        and status = 'draft'
      order by updated_at desc
      limit 1
      `,
      [projectId],
    );

    if (!quote.rows[0]) {
      return NextResponse.json({ data: null, source: "postgres" });
    }

    const items = await getPool().query(
      `
      select
        qi.product_id::text as id,
        qi.point_map_project_id::text as "pointMapProjectId",
        qi.point_ids as "pointIds",
        qi.point_map_revision as "pointMapRevision",
        qi.product_snapshot as "productSnapshot",
        coalesce(qi.product_snapshot->>'name', qi.name, p.name) as name,
        coalesce(qi.product_snapshot->>'sku', p.sku) as sku,
        coalesce(qi.product_snapshot->>'spec', qi.note, p.description, p.sku) as spec,
        case when qi.product_snapshot is not null then coalesce(qi.product_snapshot->>'category','') else coalesce(p.category,'') end as category,
        coalesce(qi.product_snapshot->>'unit', qi.unit, p.unit, '个') as unit,
        coalesce(qi.unit_price, 0)::float8 as price,
        coalesce(qi.cost_price, 0)::float8 as cost,
        coalesce(qi.room, '全屋') as room,
        coalesce(qi.quantity, 1)::float8 as quantity,
        case
          when coalesce(qi.unit_price, 0) = 0 then 100
          else (coalesce(qi.final_unit_price, qi.unit_price) / qi.unit_price * 100)::float8
        end as discount,
        case when qi.product_snapshot is not null then coalesce(qi.product_snapshot->>'image','/placeholder.svg') else coalesce(p.image,'/placeholder.svg') end as image
      from quote_items qi
      join products p on p.id = qi.product_id
      where qi.deleted_at is null
        and qi.quote_id = $1::uuid
      order by qi.sort_order asc, qi.created_at asc
      `,
      [quote.rows[0].id],
    );

    // 成本是经营者字段；普通成员仍可读取报价金额和明细，但不能从接口拿到进货价。
    const publicItems = canViewProductCost(account)
      ? items.rows
      : items.rows.map((item) => stripSnapshotCosts(item))

    // 房间只有一份出处：点位图。报价草稿里存的 rooms 是历史脏数据
    //（以前保存时会把模板房间和点位图的房间并在一起存，越存越多）。
    // 这里按点位方案现有的房间重算，前端拿到的就是唯一一份。
    const pointMapRooms = await loadPointMapRooms(projectId);
    const rooms = pointMapRooms.length ? pointMapRooms : quote.rows[0].rooms ?? [];

    return NextResponse.json({
      data: {
        ...quote.rows[0],
        rooms,
        items: publicItems,
      },
      source: "postgres",
    });
  } catch (error) {
    if (error instanceof PointMapServiceError) return pointMapApiErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QUOTE_LOAD_FAILED" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const account = requireContext(await getCurrentAccountContext(), String(body.projectId ?? ""));
    const client = await getPool().connect();
    try {
      const project = await requireVisibleProject(client, account, body.projectId);
      assertPermission(account, "project.edit");
      assertWritableMembership(account, project);
      if (body.items?.some((item: { pointMapProjectId?: string }) => item.pointMapProjectId)) assertPermission(account, "point_map.use");
    } finally { client.release(); }
    return NextResponse.json({
      data: await saveQuoteDraft(body, { context: account, actorUserId: account.user.userId, actorName: account.user.name }),
      source: "postgres",
    });
  } catch (error) {
    if (error instanceof PointMapServiceError) return pointMapApiErrorResponse(error);
    if (error instanceof QuoteSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QUOTE_SAVE_FAILED" },
      { status: 500 },
    );
  }
}

/** 点位图里实际用到的房间（楼层 / 房间），按出现顺序去重。没有点位方案时返回空。 */
async function loadPointMapRooms(projectId: string): Promise<string[]> {
  const result = await getPool().query<{ plan: unknown }>(
    `select plan from project_point_map_designs where project_id = $1::uuid`,
    [projectId],
  );
  const plan = result.rows[0]?.plan as
    | { floors?: Array<{ id: string; name: string }>; points?: Array<{ floorId?: string; room?: string }> }
    | undefined;
  if (!plan?.points) return [];
  const floorName = new Map((plan.floors ?? []).map((floor) => [floor.id, floor.name]));
  return Array.from(
    new Set(
      plan.points
        .filter((point) => point.room)
        .map((point) => {
          const floor = point.floorId ? floorName.get(point.floorId) : undefined;
          // 房间名里可能已经带楼层前缀（存量数据），别拼成「全屋 / 全屋 / 弱电箱」。
          return floor && !point.room!.startsWith(`${floor} / `) ? `${floor} / ${point.room}` : point.room!;
        }),
    ),
  );
}
