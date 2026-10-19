# Plan 009: Add product library administration and contributor review

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 5a53205..HEAD -- app/products app/api/products app/admin/products app/api/admin/products scripts lib tests`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/007-super-admin-management-shell.md`
- **Category**: direction / security
- **Planned at**: commit `5a53205`, 2026-06-28

## Why this matters

The product library is central to quotes and project planning, but super admins need a safer workflow for products added by others. This plan adds moderation states, review pages, and admin product controls without disrupting the public product catalog.

## Current state

- `app/api/products/route.ts` currently returns products where `deleted_at is null` and `coalesce(status, 'active') = 'active'`.
- The API type currently models product status as `"active" | "inactive"`.
- `scripts/neon-init.sql` stores product status as generic text and has no review metadata.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | Next.js build succeeds |
| Migration | `pnpm db:migrate` | migration applies |
| DB check | `pnpm db:check` | DB checks pass |

## Scope

**In scope**:
- product moderation migration/schema
- `app/admin/products/**`
- `app/api/admin/products/**`
- `app/api/products/route.ts`
- product service files if created under `lib/`
- tests for moderation filtering and admin review actions

**Out of scope**:
- Rebuilding the customer-facing product page UI.
- Importing products from external supplier APIs.
- Changing quote item pricing behavior.

## Steps

### Step 1: Add moderation fields

Extend product persistence to support `draft`, `pending_review`, `approved`, `rejected`, and `inactive`, plus `reviewed_by`, `reviewed_at`, `review_note`, and `submitted_by` if `created_by` is not enough. Keep public catalog behavior equivalent by treating only `approved` and legacy `active` rows as visible.

**Verify**: `pnpm db:migrate` and `pnpm db:check` pass.

### Step 2: Update public product API filtering safely

Update `app/api/products/route.ts` so regular users never see `draft`, `pending_review`, `rejected`, or `inactive` products. Preserve the existing response shape for the product library page.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Add admin product APIs

Create guarded admin routes for listing all products, creating a product, editing/deactivating a product, approving, and rejecting. Approval/rejection must record actor, reviewer note, and activity/audit entry.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Build admin product pages

Create `/admin/products` for full product library management and `/admin/products/review` for the pending review queue. Use shadcn tables, tabs, badges, dialogs/sheets, and forms.

**Verify**: `pnpm build` succeeds.

### Step 5: Add tests

Test public filtering, admin visibility of all statuses, approve/reject transitions, required rejection note, activity/audit writes, and non-super-admin 403 responses.

**Verify**: `pnpm test` passes.

## Done criteria

- [x] Product moderation states exist in persistence.
- [x] Public product library only shows approved/legacy-active products.
- [x] Super admin can review, approve, reject, edit, and deactivate products.
- [x] Review actions capture actor and timestamp.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass. `pnpm db:migrate` and `pnpm db:check` are blocked locally until `DATABASE_URL` is configured.

## STOP conditions

Stop and report if quote generation assumes product `status = 'active'` in multiple hidden places, an existing external source of product truth appears, or product image upload permissions must be redesigned.

## Maintenance notes

Future contributor-facing product submission should submit as `pending_review` and never write directly to `approved`.
