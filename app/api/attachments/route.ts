import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccountContext } from "@/lib/account-context";
import { requireAccountPermission } from "@/lib/account-gates";
import { canWriteProjectMembership, projectVisibilityWhere, type ProjectMembershipAccess } from "@/lib/project-access";
import { getPool } from "@/lib/server-db";

type AttachmentKind = "contract" | "floorplan" | "quote_pdf" | "project_file";

const ATTACHMENT_COLUMNS = `
  a.id::text,
  a.project_id::text as "projectId",
  a.kind,
  a.file_name as "fileName",
  a.file_url as "fileUrl",
  a.content_type as "contentType",
  a.size_bytes::float8 as size,
  a.created_at as "createdAt"
`;

export async function GET(request: NextRequest) {
  const context = await getCurrentAccountContext();

  if (!context) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (context.account.status !== "active") {
    return NextResponse.json({ error: "ACCOUNT_DISABLED" }, { status: 403 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  const projectIds = request.nextUrl.searchParams
    .get("projectIds")
    ?.split(",")
    .map(clean)
    .filter(Boolean);

  if (!projectId && !projectIds?.length) {
    return NextResponse.json({ data: [] });
  }

  // Attachments belong to a project, so the same owner/organisation predicate that
  // guards the project list has to apply here. Without it any signed-in account
  // could read another customer's contract and floor plan files by guessing an id.
  const visibility = projectVisibilityWhere(context, 1);

  try {
    if (projectIds?.length) {
      const result = await getPool().query(
        `
        select ${ATTACHMENT_COLUMNS}
        from project_attachments a
        join projects p on p.id = a.project_id
        where a.project_id = any($1::uuid[])
          and a.deleted_at is null
          and p.deleted_at is null
          and (${visibility.where})
        order by a.project_id, a.created_at desc
        `,
        [projectIds.slice(0, 200), ...visibility.params],
      );

      return NextResponse.json({ data: result.rows, source: "postgres" });
    }

    const result = await getPool().query(
      `
      select ${ATTACHMENT_COLUMNS}
      from project_attachments a
      join projects p on p.id = a.project_id
      where a.project_id = $1::uuid
        and a.deleted_at is null
        and p.deleted_at is null
        and (${visibility.where})
      order by a.created_at desc
      `,
      [projectId, ...visibility.params],
    );

    return NextResponse.json({ data: result.rows, source: "postgres" });
  } catch (error) {
    return NextResponse.json(
      {
        data: [],
        error:
          error instanceof Error ? error.message : "ATTACHMENTS_UNAVAILABLE",
      },
      { status: 200 },
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await getCurrentAccountContext();

  if (!context) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const edit = requireAccountPermission(context, "project.edit");

  if (!edit.allowed) {
    return NextResponse.json(
      { error: "PROJECT_EDIT_REQUIRED", reason: edit.reason },
      { status: 403 },
    );
  }

  try {
    const payload = await request.json();
    const projectId = clean(payload.projectId);
    const kind = normalizeKind(payload.kind);
    const fileName = clean(payload.fileName);
    const fileUrl = clean(payload.fileUrl);
    const contentType =
      clean(payload.contentType) || "application/octet-stream";
    const size = Number(payload.size || 0);

    if (!projectId || !fileName || !fileUrl) {
      return NextResponse.json(
        { error: "PROJECT_FILE_REQUIRED" },
        { status: 400 },
      );
    }

    const visibility = projectVisibilityWhere(context, 1);
    const actorParameter = `$${visibility.params.length + 2}`;
    const project = await getPool().query<ProjectMembershipAccess>(
      `
      select p.created_by::text as "createdBy",
        (select pm.access_level::text from project_members pm
         where pm.project_id = p.id and pm.user_id = ${actorParameter}::uuid and pm.status = 'active'
         limit 1) as "accessLevel"
      from projects p
      where p.id = $1::uuid
        and p.deleted_at is null
        and (${visibility.where})
      limit 1
      `,
      [projectId, ...visibility.params, context.user.userId],
    );

    if (!project.rows[0]) {
      return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
    }

    if (!canWriteProjectMembership(context, project.rows[0])) {
      return NextResponse.json({ error: "PROJECT_READ_ONLY" }, { status: 403 });
    }

    const result = await getPool().query(
      `
      insert into project_attachments (
        created_by, updated_by, project_id, kind, file_name, file_url, content_type, size_bytes
      )
      values ($1, $1, $2::uuid, $3, $4, $5, $6, $7)
      returning
        id::text,
        project_id::text as "projectId",
        kind,
        file_name as "fileName",
        file_url as "fileUrl",
        content_type as "contentType",
        size_bytes::float8 as size,
        created_at as "createdAt"
      `,
      [
        context.user.userId,
        projectId,
        kind,
        fileName,
        fileUrl,
        contentType,
        size,
      ],
    );

    return NextResponse.json({ data: result.rows[0], source: "postgres" });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "ATTACHMENT_SAVE_FAILED",
      },
      { status: 500 },
    );
  }
}

function normalizeKind(value: unknown): AttachmentKind {
  const kind = clean(value);

  if (kind === "contract" || kind === "floorplan" || kind === "quote_pdf") {
    return kind;
  }

  return "project_file";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}
