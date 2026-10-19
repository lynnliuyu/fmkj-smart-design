# Plan 013: 重新设计仪表盘信息架构以减少重复内容

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 97dae55..HEAD -- app/page.tsx components/dashboard lib/activity-feed.ts app/api/activities tests`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/005-persist-business-activity-log.md`, `plans/006-activity-notification-and-timeline-ui.md`
- **Category**: direction / UI
- **Planned at**: commit `97dae55`, 2026-06-28

## Why this matters

The current dashboard repeats similar operational signals in hero copy, metric cards, charts, notification list, and health cards. A better dashboard should answer different questions in different zones: today what needs action, pipeline where it is stuck, money what changed, team who did it, and alerts what is risky.

## Current state

- `app/page.tsx` renders `OperationsDashboard` inside the app shell.
- `components/dashboard/operations-dashboard.tsx` contains all dashboard data, layout, static sample arrays, activity fetch, charts, and cards in one large component.
- The component mixes a large hero, stage cards, notification list, KPI cards, revenue chart, point chart, health cards, image/product vignette, and activity timeline.
- Activity logs exist and are already fetched from `/api/activities`; keep that feed.
- shadcn official dashboard examples emphasize sidebar app shells with charts and data tables, and shadcn chart docs are built on Recharts, which this repo already uses.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 errors |
| Build | `pnpm build` | Next.js build succeeds |

## Scope

**In scope**:
- `components/dashboard/operations-dashboard.tsx`
- optional split components under `components/dashboard/**`
- `lib/activity-feed.ts` only if a display mapping needs a small extension
- dashboard-specific tests if pure helper functions are extracted

**Out of scope**:
- Changing persisted activity log schema.
- Building admin analytics pages from Plan 010.
- Moving `/` route.

## Steps

### Step 1: Define a non-overlapping dashboard map

Restructure the dashboard into these zones:

- Action rail: top 3 urgent items from activity/risk data.
- KPI strip: 报价金额, 已收款, 待定位点位, 今日待办, each with one distinct meaning.
- Pipeline board: project stages with counts and bottleneck indication.
- Conversion chart: quote to paid conversion, not duplicated elsewhere.
- Activity feed: who did what and when, using existing Notification List/Timeline.
- Workload panel: team availability or work-order queue.

Remove or merge cards that repeat the same numbers.

**Verify**: no duplicated label/value pairs remain in the component.

### Step 2: Split the large component into maintainable sections

Extract local components such as:

- `DashboardKpiStrip`
- `ProjectPipelineSummary`
- `RevenueConversionChart`
- `OperationalActionList`
- `TeamWorkloadPanel`

Keep them under `components/dashboard/` and keep the data contract simple.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Replace mojibake copy and tune density

Rewrite visible dashboard copy in readable Chinese. Use compact headings and shorter descriptions because this is an operational tool, not a marketing page.

Avoid a large hero panel on the dashboard. Use a concise page title row and dense information blocks.

**Verify**: browser check at desktop and mobile widths shows no text overflow or incoherent overlap.

### Step 4: Keep Animate UI components where they add value

Keep `NotificationList`, `ActivityTimeline`, and `UserPresenceAvatar` only where they answer a dashboard question. Do not place animated components just for decoration.

**Verify**: `pnpm build` succeeds.

## Test plan

- Existing `pnpm test` should pass.
- Add tests for any extracted pure functions that compute KPI values or stage totals.
- Manual browser checks:
  - Dashboard has no repeated KPI content.
  - Mobile layout stacks cleanly.
  - Activity list still loads from `/api/activities`.

## Done criteria

- [ ] Dashboard zones have distinct jobs and no obvious duplicate content.
- [ ] Visible Chinese text is readable.
- [ ] Large hero panel is replaced by a tighter operational header.
- [ ] Component is split enough that future edits do not require touching one huge file.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass.

## STOP conditions

Stop and report if real backend data contracts are needed to compute promised metrics. Use clearly labeled sample data rather than inventing API behavior.

## Maintenance notes

Dashboard should remain an operator home, not an admin analytics surface. Platform-wide access/server/database metrics belong in Plan 010.
