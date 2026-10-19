# Plan 005: Build a persistent business activity log

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise.
>
> **Drift check (run first)**:
>
> ```powershell
> git diff --stat 593cf8b..HEAD -- app/api/activities/route.ts lib/activity-feed.ts app/api/projects/route.ts app/api/quotes/route.ts scripts/neon-init.sql scripts/check-neon.mjs tests
> ```
>
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction / architecture
- **Planned at**: commit `593cf8b`, 2026-06-28
- **Implementation status**: DONE in this execution pass.

## Why this matters

The dashboard now has a business activity feed, but it is inferred from current rows rather than stored as an audit-quality timeline. That means project stage history, quote generation time, work order completion time, and "who did it" can be inaccurate or lost after an update. FMKJ's domain already names **操作日志 / Audit Log** as a core concept in `CONTEXT.md`, and the product needs activity records for project progress, work orders, quotes, and operator accountability. This plan creates the persistent data foundation.

## Current state

- `CONTEXT.md` defines the domain. Relevant vocabulary:
  - **项目 / Project**: customer business project.
  - **方案报价 / Quote**: quotation generated from project needs and selected products.
  - **工单 / Task**: work item for delivery, installation, service, or internal follow-up.
  - **操作日志 / Audit Log**: records platform management operations.
- `scripts/neon-init.sql:52-80` defines `projects` with `created_by`, `updated_by`, `stage`, `created_at`, and `updated_at`, but no stage history table.
- `scripts/neon-init.sql:83-101` defines `quotes` with `created_by`, `updated_by`, `created_at`, and `updated_at`.
- `scripts/neon-init.sql:127-140` defines `project_attachments`. There is no `work_orders` table yet; current work orders are static data in `lib/tasks-data.ts`.
- `app/api/activities/route.ts:33-104` currently builds activities by querying `projects` and `quotes`, then appending synthetic work order activities from `tasks`.
- `app/api/activities/route.ts:107-151` treats a project as "stage changed" when `updated_at - created_at > 5 minutes`. This is a heuristic, not real stage history.
- `app/api/projects/route.ts:146-175` creates projects but does not write a separate activity record.
- `app/api/projects/route.ts:210-237` advances a project stage but overwrites `stage` and `updated_at`; previous stage and exact transition time are not retained.
- `app/api/quotes/route.ts:148-201` inserts or updates a quote; `app/api/quotes/route.ts:242-252` also updates the project quote amount. Neither write a first-class activity event.

Repo conventions to match:

- Next.js App Router API routes live under `app/api/<name>/route.ts`.
- Database access uses `pg` directly and SQL strings, usually through `getPool()` from `lib/server-db.ts`.
- Existing business routes return JSON in the shape `{ data, source }` and catch database errors with a JSON error payload.
- Tests use Vitest and colocate under `tests/`; see `tests/quote-point-map-command.test.ts` for simple domain-level unit tests.

## Commands you will need

| Purpose   | Command          | Expected on success                                                        |
| --------- | ---------------- | -------------------------------------------------------------------------- |
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors                                               |
| Tests     | `pnpm test`      | exit 0, all 42+ tests pass                                                 |
| Lint      | `pnpm lint`      | exit 0; existing warnings may remain, but no new warnings in touched files |
| Build     | `pnpm build`     | exit 0; `/api/activities` remains listed                                   |

## Scope

**In scope**:

- `scripts/neon-init.sql`
- `scripts/create-activity-log-table.sql` (create)
- `scripts/run-migration.mjs`
- `scripts/check-neon.mjs`
- `lib/activity-feed.ts`
- `lib/server-activity-log.ts` (create)
- `app/api/activities/route.ts`
- `app/api/projects/route.ts`
- `app/api/quotes/route.ts`
- `tests/activity-feed.test.ts` (create)
- `tests/server-activity-log.test.ts` (create if practical without a real database; otherwise cover SQL payload building in a pure helper)

**Out of scope**:

- Replacing static `lib/tasks-data.ts` with a real `work_orders` table. That is a follow-up; this plan can log work-order-like events only once a real write path exists.
- Reworking authentication/session identity. Use the current `SYSTEM_USER_ID` pattern where the existing API routes do.
- Changing dashboard UI layout. Plan 006 covers UI refinements.
- Changing account-system in-memory audit services under `lib/account-system/`.

## Git workflow

- Branch: `codex/activity-log-persistence`
- Commit message style: conventional commit, for example `feat: persist business activity logs`.
- Do not push unless the operator asks.

## Steps

### Step 1: Add the database schema

Add an `activity_logs` table to `scripts/neon-init.sql` after `project_attachments`. Use a general event shape that can support project, quote, work order, point map, product, account, and billing events later.

Target shape:

```sql
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  actor_name text,
  entity_type text not null,
  entity_id uuid,
  entity_label text not null,
  action text not null,
  title text not null,
  description text not null,
  occurred_at timestamptz not null default now(),
  duration_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_recent_idx
  on activity_logs (occurred_at desc, created_at desc);

create index if not exists activity_logs_entity_idx
  on activity_logs (entity_type, entity_id, occurred_at desc);
```

Also update `scripts/check-neon.mjs` so `activity_logs` is included in the required table list.

**Verify**: `pnpm typecheck` exits 0. This step should not require runtime DB access.

### Step 2: Create a server activity writer

Create `lib/server-activity-log.ts`.

It should export:

- `type ActivityAction` including at least:
  - `project.created`
  - `project.stage_advanced`
  - `project.risk_toggled`
  - `quote.created`
  - `quote.updated`
  - `work_order.created`
  - `work_order.completed`
- `type RecordActivityInput`
- `recordActivity(clientOrPool, input)` or two variants if passing a transaction client is cleaner.

The writer must:

- Insert into `activity_logs`.
- Accept `actorId`, `actorName`, `entityType`, `entityId`, `entityLabel`, `action`, `title`, `description`, `occurredAt`, `durationSeconds`, and `metadata`.
- Not throw away the original route transaction. For `app/api/quotes/route.ts`, use the same transaction client so quote save and activity write commit or rollback together.
- Return the inserted `id` when available.

Keep this module server-only by not importing it from client components.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Write project activities at mutation points

In `app/api/projects/route.ts`:

- After a successful project insert at `app/api/projects/route.ts:146-175`, write `project.created`.
- In `updateProjectStage`, before updating, read the current `stage`, `stage_label`, and `created_at`. After updating, write `project.stage_advanced` with:
  - previous stage
  - next stage
  - duration from project `created_at` to the stage update time
  - actor id/name using the existing `SYSTEM_USER_ID` and current hardcoded system actor name if no session identity exists.
- In `toggleProjectRisk`, write `project.risk_toggled` with previous/new risk state in metadata.

Use one helper to format duration seconds and one helper to build titles/descriptions so text stays consistent with the dashboard vocabulary.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Write quote activities inside the quote transaction

In `app/api/quotes/route.ts`:

- For the `existingQuote.rows[0] ? update : insert` branch at `app/api/quotes/route.ts:148-201`, detect whether this is a new quote or an update.
- After quote items are written and before `commit`, write:
  - `quote.created` for the insert path.
  - `quote.updated` for the update path.
- Include metadata:
  - `quoteNo`
  - `projectId`
  - `subtotal`
  - `discount`
  - `total`
  - `itemCount`
  - `roomCount`
  - `durationSecondsFromProjectCreated`
- Use the same `client` transaction used by the quote route.

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Make `/api/activities` read real logs first

Update `app/api/activities/route.ts`:

- Query `activity_logs` first:
  - order by `occurred_at desc, created_at desc`
  - limit 12
  - map rows into `ActivityFeedItem`
- Keep the current inferred fallback path, but only use it if `activity_logs` does not exist, query fails, or there are zero rows.
- Do not expose raw internal error details to the UI. It is acceptable to return `source: "fallback"` and a generic error string.

Mapping rules:

- `project.created` -> `kind: "project-created"`, `iconKey: "project"`, sky tone.
- `project.stage_advanced` -> `kind: "project-advanced"`, `iconKey: "map"`, emerald tone.
- `project.risk_toggled` -> `kind: "risk"`, `iconKey: "alert"`, red tone when blocked, amber tone otherwise.
- `quote.created` / `quote.updated` -> `kind: "quote-generated"`, `iconKey: "quote"`, amber tone.
- `work_order.created` -> `kind: "work-order-created"`, `iconKey: "hammer"`, violet tone.
- `work_order.completed` -> `kind: "work-order-completed"`, `iconKey: "check"`, emerald tone.

**Verify**: `pnpm typecheck` exits 0.

### Step 6: Add tests for formatting and mapping

Create or update tests:

- `tests/activity-feed.test.ts`:
  - `formatDuration` returns `1 小时内` for short duration.
  - `formatDuration` returns hours/days for longer duration.
  - `formatRelativeTime` returns expected Chinese labels when a fixed `now` is passed.
- If you create a pure mapper in `app/api/activities/route.ts` or move it into `lib/activity-feed.ts`, test:
  - `project.stage_advanced` maps to `project-advanced`.
  - `quote.created` maps to quote icon/tone.
  - risk events map to red/alert.

Use `tests/quote-point-map-command.test.ts` as the Vitest structure pattern.

**Verify**: `pnpm test` exits 0 and includes the new tests.

## Test plan

- Unit tests for duration/relative-time formatting.
- Unit tests for activity row-to-feed-item mapping if the mapper is made pure.
- Route-level DB integration tests are out of scope because the repo does not currently have a test database harness.
- Manual verification after migration:
  - Create a project.
  - Advance the project stage.
  - Save a quote.
  - Query `/api/activities` while logged in and confirm the returned feed includes the new events in reverse chronological order.

## Done criteria

- [ ] `scripts/neon-init.sql` defines `activity_logs` and indexes.
- [ ] `scripts/create-activity-log-table.sql` can create `activity_logs` for existing Neon databases.
- [ ] `scripts/run-migration.mjs` runs the activity-log migration.
- [ ] `scripts/check-neon.mjs` checks `activity_logs`.
- [ ] Project create, project advance, risk toggle, quote create, and quote update write activity rows.
- [ ] `/api/activities` reads `activity_logs` first and falls back safely.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0 with new activity tests.
- [ ] `pnpm build` exits 0.
- [ ] No files outside the in-scope list are modified.

## STOP conditions

Stop and report back if:

- The project or quote route has drifted so the cited mutation locations no longer exist.
- The database migration strategy changes from SQL files to a different migration system.
- You discover that production already has an `activity_logs` table with a different schema.
- Recording activities requires real user session identity and cannot safely use the existing `SYSTEM_USER_ID` pattern.
- A verification command fails twice after reasonable fixes.

## Maintenance notes

- When real work orders are added, their create/complete API routes should call the same `recordActivity` helper.
- Keep activity descriptions short. Long detail belongs in `metadata`; the dashboard should remain scannable.
- Reviewers should check that activity writes occur inside the same transaction as the business mutation where possible.
- Future tenant/enterprise isolation should populate `tenant_id`; do not make it required until organization scoping is fully implemented.
