# Plan 007: 建立只对超级管理员可见的平台管理入口

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5a53205..HEAD -- components/app-sidebar.tsx lib/account-context.ts app/api/auth/session/route.ts middleware.ts app/admin app/api/admin tests`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security / direction
- **Planned at**: commit `5a53205`, 2026-06-28

## Why this matters

The requested management area controls customers, plans, products, environment, servers, database status, and access data, so hiding links in the sidebar is not enough. This plan creates the secure shell first: only a super admin can see the sidebar group, open `/admin/*` pages, or call `/api/admin/*` endpoints.

## Current state

- `components/app-sidebar.tsx` is a client component with static sidebar arrays. It has no session-aware admin group:

```tsx
// components/app-sidebar.tsx:54-64
const navGeneral = [
  { label: "...", icon: LayoutDashboard, url: "/" },
  { label: "...", icon: PackageSearch, url: "/products" },
  { label: "...", icon: LockKeyhole, url: "/account-system" },
];
```

- `lib/account-context.ts` already exposes the account facts this feature must use:

```ts
// lib/account-context.ts:14-19
isSuperAdmin: boolean
permissions: PermissionCode[]

// lib/account-context.ts:63-66
SUPER_ADMIN: [
  "account.manage_all",
  "platform.manage_features",
```

- `app/api/auth/session/route.ts` returns `accountContext`, so the sidebar can derive visibility from the same account contract.
- `middleware.ts` only checks that a session token exists; it does not enforce super-admin routes.
- Domain vocabulary to preserve: Super Admin is the platform highest-permission account and can manage all accounts, plans, orders, feature flags, and audit logs. Use Chinese labels in UI and keep shadcn/ui sidebar patterns consistent.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | Next.js build succeeds |

## Scope

**In scope**:
- `components/app-sidebar.tsx`
- `app/admin/**`
- `app/api/admin/**`
- `lib/admin-auth.ts` or `lib/super-admin.ts`
- `tests/admin-auth.test.ts`

**Out of scope**:
- Customer CRUD, plan editing, product moderation, or system metrics beyond placeholder cards.
- Changing public product/project/quote APIs.
- Storing or showing any secret environment values.

## Steps

### Step 1: Add a shared server-side super-admin guard

Create `lib/admin-auth.ts` with `isSuperAdminContext(context)`, `requireSuperAdmin()`, and `adminJsonForbidden()`. Use `getCurrentAccountContext()` and `accountContextCan()` from `lib/account-context.ts`; do not parse roles manually in every route.

**Verify**: `pnpm typecheck` exits 0.

### Step 2: Add tests for the guard contract

Create `tests/admin-auth.test.ts` following `tests/account-context.test.ts`. Cover super admin allowed, enterprise owner denied, personal pro/free denied, disabled super admin denied, and missing context unauthorized.

**Verify**: `pnpm test -- tests/admin-auth.test.ts` passes.

### Step 3: Create the `/admin` route shell

Create `app/admin/page.tsx` as the platform management overview. It must call `requireSuperAdmin()` on the server before rendering.

Suggested overview cards: 客户与账号, 套餐与价格, 产品审核, 产品库管理, 项目环境, 服务器与配置, 访问数据, 数据库状态, 操作日志. Keep it dense and operational; do not make a marketing hero.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Add the super-admin-only sidebar group

Update `components/app-sidebar.tsx` so it can know whether the current user is a super admin. Preferred group label: `平台管理`. Items:

- `管理概览` -> `/admin`
- `客户与账号` -> `/admin/customers`
- `套餐与价格` -> `/admin/plans`
- `产品审核` -> `/admin/products/review`
- `产品库管理` -> `/admin/products`
- `项目环境` -> `/admin/environments`
- `服务器与配置` -> `/admin/system`
- `访问数据` -> `/admin/analytics`
- `数据库状态` -> `/admin/database`
- `操作日志` -> `/admin/audit-logs`

Use lucide icons and the existing sidebar style.

**Verify**: `pnpm typecheck` exits 0.

### Step 5: Add route-level deny behavior

For placeholder pages under `/admin/*`, either call `requireSuperAdmin()` at the top of every page or create `app/admin/layout.tsx` that calls the guard before rendering children. Non-admin users must not receive admin content even if they type the URL directly.

**Verify**: `pnpm build` succeeds.

## Test plan

- Unit tests in `tests/admin-auth.test.ts` for the guard contract.
- Manual check: log in as super admin and confirm `平台管理` appears; log in as non-admin and confirm it does not appear and `/admin` is blocked.

## Done criteria

- [ ] `/admin` is not accessible to non-super-admin users.
- [ ] `/api/admin/*` has a reusable guard path ready for later API routes.
- [ ] Sidebar shows `平台管理` only for super admin.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if `getCurrentAccountContext()` cannot be used in the target server runtime, the app layout requires a larger sidebar refactor than this plan's scope, or any implementation would expose raw environment variable values or credentials.

## Maintenance notes

All future platform management pages must reuse this guard. Reviewers should reject any `/admin` page or `/api/admin` route that only relies on client-side hiding.
