# Plan 008: Build platform customer, account, plan, and price management

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 5a53205..HEAD -- app/admin app/api/admin lib/account-system lib/account-context.ts scripts tests`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/007-super-admin-management-shell.md`
- **Category**: direction / migration / security
- **Planned at**: commit `5a53205`, 2026-06-28

## Why this matters

The product needs an operator page where the super admin can create customers, assign account identity, and manage paid plans without editing database rows by hand. This plan turns the existing account-tier domain vocabulary into real admin screens and guarded API endpoints.

## Current state

- `lib/account-system/domain.ts` already defines `AccountType`, `PlanCode`, `SubscriptionStatus`, `PlanLimits`, `Plan`, and `Subscription`.
- `lib/account-context.ts` gives super admins `account.manage_all` and `platform.manage_features`.
- `scripts/neon-init.sql` currently creates core business tables but not persisted plan/subscription/account-profile admin management tables.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | Next.js build succeeds |
| Migration | `pnpm db:migrate` | migration applies without SQL errors |
| DB check | `pnpm db:check` | connection and table checks pass |

## Scope

**In scope**:
- `scripts/neon-init.sql` or a new migration file matching the repo pattern
- `lib/account-system/**`
- `app/admin/customers/**`
- `app/admin/plans/**`
- `app/api/admin/customers/**`
- `app/api/admin/plans/**`
- tests for admin customer/plan services

**Out of scope**:
- Payment provider integration.
- Public self-service upgrade checkout.
- Enterprise member invitation UX.
- Any secret value display.

## Steps

### Step 1: Persist the missing account commerce entities

Add database structures for `account_profiles`, `plans`, and `subscriptions`. Seed default plans for 免费个人版, 个人升级版 monthly/yearly, and 企业版 monthly/yearly/custom. Limits must match the product rules: free personal has one project and no point map; personal pro has point map but no team/subaccount; enterprise enables team/subaccounts.

**Verify**: `pnpm db:migrate` then `pnpm db:check` pass.

### Step 2: Add admin services with a narrow API surface

In `lib/account-system/`, add or extend services to list customers, create customers, update account type/status, assign plan/subscription, list plans, and update plan price/limits/active state. Every mutation must accept `actorUserId` and write an audit/activity row.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Add guarded admin API routes

Create guarded routes under `app/api/admin/customers/**` and `app/api/admin/plans/**`. Every route must call the Plan 007 super-admin guard. Return consistent `401`, `403`, and `400 VALIDATION_ERROR` payloads.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Build shadcn-style admin pages

Create `/admin/customers`, `/admin/customers/[id]`, and `/admin/plans`. Use shadcn tables, badges, dialogs/sheets, selects, switches, and inputs. Keep the UI compact and operational.

**Verify**: `pnpm build` succeeds.

### Step 5: Add tests

Test default plans, plan assignment, account type changes, limits for free/pro/enterprise, audit logging, and non-super-admin denial.

**Verify**: `pnpm test` passes.

## Done criteria

- [ ] Super admin can create a customer from UI.
- [ ] Super admin can set account type and plan/subscription from UI.
- [ ] Plan prices and limits can be edited without direct SQL.
- [ ] Non-super-admin API calls receive 403.
- [ ] Mutations create audit/activity records.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm db:migrate`, and `pnpm db:check` pass.

## STOP conditions

Stop and report if existing migrations already created incompatible tables, the repo lacks a stable migration mechanism, account context cannot read persisted profiles without breaking login, or checkout/payment becomes necessary.

## Maintenance notes

This page becomes the source of truth for manual customer operations. Reviewers should scrutinize audit logging, validation, and whether plan limits map back to permission checks.
