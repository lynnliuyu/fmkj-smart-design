# Plan 010: Add platform operations, health, database, and access analytics pages

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 5a53205..HEAD -- app/admin app/api/admin lib/server-db.ts lib/server-activity-log.ts scripts tests`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/007-super-admin-management-shell.md`
- **Category**: direction / dx / security
- **Planned at**: commit `5a53205`, 2026-06-28

## Why this matters

The super admin needs to see whether the deployed system is healthy without opening Vercel, Neon, or database consoles for routine checks. This plan adds safe operational pages for environment presence, server health, access trends, and database capacity while redacting secrets by design.

## Current state

- `scripts/neon-init.sql` creates operationally useful tables: products, projects, quotes, quote items, project attachments, and `activity_logs`.
- The user deploys on Vercel and uses Neon/Postgres.
- Do not expose connection strings, passwords, tokens, or full environment values in UI or JSON responses.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | Next.js build succeeds |
| DB check | `pnpm db:check` | connection and baseline checks pass |

## Scope

**In scope**:
- `app/admin/system/**`
- `app/admin/environments/**`
- `app/admin/database/**`
- `app/admin/analytics/**`
- `app/admin/audit-logs/**`
- `app/api/admin/system/**`
- `lib/platform-health.ts` or similar helper
- tests for redaction and metric formatting

**Out of scope**:
- Direct server restart/deploy controls.
- Editing production secrets from the app.
- Replacing Vercel or Neon dashboards.
- Real-time infrastructure monitoring with alerts.

## Steps

### Step 1: Create a redacted platform health service

Create `lib/platform-health.ts` with `getEnvironmentStatus()`, `getDatabaseStatus()`, `getServerStatus()`, and `getAccessAnalytics()`. Environment status must return a whitelist of expected keys and only `present: boolean`, never raw values.

Redaction rule: JSON responses must not contain values from secret-like keys (`DATABASE_URL`, `PASSWORD`, `TOKEN`, `SECRET`, `KEY`) except the key names themselves.

**Verify**: `pnpm typecheck` exits 0.

### Step 2: Add guarded admin APIs

Create `GET /api/admin/system/health`, `/environment`, `/database`, `/analytics`, and `GET /api/admin/audit-logs`. Every route must call the Plan 007 guard. Use no-store semantics for live health data. On database metric failure, return partial data plus a safe error code.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Build operations pages

Create `/admin/system`, `/admin/environments`, `/admin/database`, `/admin/analytics`, and `/admin/audit-logs`. Use shadcn components and Recharts if charts are needed. Keep all views compact, table-first, and suitable for repeated admin use.

**Verify**: `pnpm build` succeeds.

### Step 4: Add redaction and metric tests

Test environment redaction, API payload redaction, DB failure handling, empty activity log analytics, and non-super-admin 403 responses.

**Verify**: `pnpm test` passes.

## Done criteria

- [x] Super admin can view system, environment, database, access analytics, and audit-log pages.
- [x] No raw secret/env values appear in rendered HTML or API JSON.
- [x] DB metrics are safe and degrade gracefully.
- [x] Non-super-admin users cannot access pages or APIs.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass. `pnpm db:check` is blocked locally until `DATABASE_URL` is configured.

## STOP conditions

Stop and report if Vercel/Neon metrics require external API credentials not already configured, database size queries require permissions Neon does not grant, any error payload would include credentials, or the app lacks a reliable super-admin check.

## Maintenance notes

This should remain a read-only operations console. If future work adds deploy/restart/config write actions, create a separate plan with confirmation flows and stronger audit logging.
