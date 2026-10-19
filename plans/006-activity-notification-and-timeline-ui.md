# Plan 006: Turn activity logs into dashboard notifications and entity timelines

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise.
>
> **Drift check (run first)**:
>
> ```powershell
> git diff --stat 593cf8b..HEAD -- components/dashboard/operations-dashboard.tsx components/animate-ui/notification-list.tsx lib/activity-feed.ts app/api/activities/route.ts components/projects components/quotes components/tasks
> ```
>
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/005-persist-business-activity-log.md`
- **Category**: direction / UI
- **Planned at**: commit `593cf8b`, 2026-06-28
- **Implementation status**: DONE in this execution pass.

## Why this matters

Once activity logs are real, the dashboard should not only say "something happened"; it should answer the operator's practical questions: who created the project, how long it took to reach the next stage, when a work order was created, how long it took to finish, and who generated the quote. The current dashboard notification list is a good first surface, but it only shows four compact items and discards actor/duration fields. This plan makes the activity feed useful in the home dashboard and prepares reusable timelines for project, quote, and work order detail pages.

## Current state

- `components/dashboard/operations-dashboard.tsx:150-182` fetches `/api/activities`, maps only the first four items to Notification List items, and falls back to static `upcoming`.
- `components/dashboard/operations-dashboard.tsx:261-274` renders the right-side card titled `业务动态` with `<NotificationList items={activityItems} />`.
- `components/animate-ui/notification-list.tsx` accepts only `{ title, description, time, icon, tone }`.
- `lib/activity-feed.ts:29-40` defines richer activity fields: `actor`, `subject`, `happenedAt`, `duration`, `iconKey`, and `tone`.
- `lib/activity-feed.ts:61-71` currently maps `ActivityFeedItem` into `ActivityNotificationItem` and drops actor, subject, and duration.
- `app/api/activities/route.ts` returns up to 12 activities, but the dashboard uses only four.

Repo design constraints:

- Keep the existing shadcn/ui visual language. Use `Card`, `Badge`, `Button`, `Separator`, and existing `components/animate-ui/*` local components.
- Avoid marketing-style visual noise inside the operational dashboard. The dashboard should remain compact and scannable.
- Chinese UI copy is preferred.

## Commands you will need

| Purpose   | Command          | Expected on success                                                        |
| --------- | ---------------- | -------------------------------------------------------------------------- |
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors                                               |
| Tests     | `pnpm test`      | exit 0, all tests pass                                                     |
| Lint      | `pnpm lint`      | exit 0; existing warnings may remain, but no new warnings in touched files |
| Build     | `pnpm build`     | exit 0                                                                     |

## Scope

**In scope**:

- `lib/activity-feed.ts`
- `components/animate-ui/notification-list.tsx`
- `components/animate-ui/activity-timeline.tsx` (create)
- `components/dashboard/operations-dashboard.tsx`
- `components/projects/project-flow.tsx` only if adding a project-level timeline panel is still small.
- Tests for pure formatting/mapping helpers if not already covered by Plan 005.

**Out of scope**:

- Database schema and event writing. Plan 005 owns that.
- Rebuilding project, quote, or task pages.
- Adding websockets or live polling. Use simple fetch first.
- Adding a new UI dependency. Keep using shadcn/Tailwind/lucide.

## Git workflow

- Branch: `codex/activity-notification-ui`
- Commit message style: conventional commit, for example `feat: show activity timelines`.
- Do not push unless the operator asks.

## Steps

### Step 1: Preserve actor and duration in notification items

Update `lib/activity-feed.ts` so `ActivityNotificationItem` includes optional:

- `actor`
- `subject`
- `duration`
- `happenedAt`

Update `toActivityNotification` so these fields are passed through.

**Verify**: `pnpm typecheck` exits 0.

### Step 2: Make Notification List show operational context

Update `components/animate-ui/notification-list.tsx`:

- Keep the compact layout.
- Under the description, add a muted metadata row when fields exist:
  - `操作人：<actor>`
  - `耗时：<duration>`
  - Use a dot separator or small `Badge` only if it remains compact.
- Keep `time` on the right.
- Preserve the current animation classes.
- Ensure long project names truncate and do not overflow on mobile.

Target copy style:

```tsx
<div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
  {item.actor && <span>操作人：{item.actor}</span>}
  {item.duration && <span>耗时：{item.duration}</span>}
</div>
```

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Add a reusable ActivityTimeline component

Create `components/animate-ui/activity-timeline.tsx`.

Props:

```ts
type ActivityTimelineProps = {
  items: ActivityFeedItem[];
  emptyText?: string;
  className?: string;
};
```

Behavior:

- Render chronological events in reverse chronological order.
- Use `activityIconMap` from `lib/activity-feed.ts` for icons.
- Show:
  - title
  - description
  - time
  - actor
  - duration if present
- Use shadcn-style borders, `Badge`, and small icon cells.
- Render a quiet empty state if there are no items.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Upgrade the dashboard activity card

In `components/dashboard/operations-dashboard.tsx`:

- Fetch up to 8 activities instead of showing only 4, but keep only 4 visible in the compact card.
- Add a small secondary button or text button labeled `查看全部`.
- When clicked, either:
  - expand the card inline to show all loaded activities using `ActivityTimeline`, or
  - open a shadcn `Dialog` with `ActivityTimeline`.

Recommended: use a `Dialog` so the dashboard remains dense.

Dialog title: `业务活动记录`

Dialog description: `项目、报价和工单的创建、推进、完成和操作人记录。`

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Optional project-level timeline panel

If Plan 005 exposes filtering in `/api/activities?entityType=project&entityId=<id>`, add a small timeline panel to the selected project area in `components/projects/project-flow.tsx`.

If the API does not support filters yet, skip this step and record it as deferred in the final summary. Do not implement filtering ad hoc in the UI.

**Verify**: `pnpm typecheck` exits 0.

### Step 6: Add focused tests for mapping behavior

If not already covered by Plan 005, add tests that confirm:

- `toActivityNotification` preserves `actor`.
- `toActivityNotification` preserves `duration`.
- Missing optional fields do not break mapping.

Use `tests/quote-point-map-command.test.ts` as the Vitest style reference.

**Verify**: `pnpm test` exits 0.

## Test plan

- Unit tests for `toActivityNotification` if changed.
- Manual UI check:
  - Dashboard shows compact business dynamics.
  - Each item can show operator and duration without wrapping badly.
  - `查看全部` opens the full timeline if implemented.
  - Mobile width does not overflow.

## Done criteria

- [ ] Notification items can display actor and duration.
- [ ] Dashboard compact card still fits in the right column.
- [ ] Full activity timeline is accessible from the dashboard.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] No new lint warnings in touched files.

## STOP conditions

Stop and report back if:

- Plan 005 has not landed or `/api/activities` does not return persistent activity rows.
- The dashboard layout has changed enough that the right-side activity card no longer exists.
- Adding a project-level timeline requires broad restructuring of `components/projects/project-flow.tsx`.
- The implementation appears to require a new dependency.
- A verification command fails twice after reasonable fixes.

## Maintenance notes

- If websocket or polling is added later, keep this component API stable and change only the data loading layer.
- Do not put large metadata blobs in the Notification List; keep detailed payloads for a future activity detail drawer.
- Reviewers should check mobile layout and long Chinese project names.
