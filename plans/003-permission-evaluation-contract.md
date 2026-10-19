# Plan 003: Specify the permission evaluation contract

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git status --short -- docs/account-tier-and-upgrade-plan.md plans/003-permission-evaluation-contract.md`
> If `docs/account-tier-and-upgrade-plan.md` has changed since this plan was written, compare the "Current state" excerpts below against the live document before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-acceptance-ready-account-rules.md`, `plans/002-account-organization-subscription-data-model.md`
- **Category**: security
- **Planned at**: `uncommitted-initial-state`, 2026-06-28

## Why This Matters

The document names sensitive capabilities: platform account management, enterprise member management, point map access, advanced export, and billing views. These capabilities need one shared permission contract so backend, frontend, and admin screens do not invent separate checks. A clear contract also prevents UI-only enforcement for paid or tenant-scoped features.

## Current State

Relevant file:

- `docs/account-tier-and-upgrade-plan.md` — includes permission matrix and suggested permission points.

Important excerpts:

```text
docs/account-tier-and-upgrade-plan.md:106
## 3. 权限矩阵

| 功能 | 超级管理员 | 企业版主账号 | 企业版子账号 | 个人升级版 | 个人免费版 |
...
| 点位图 | 支持 | 支持 | 按权限 | 支持 | 不支持 |
```

```text
docs/account-tier-and-upgrade-plan.md:364
### 9.4 核心权限点

account.manage_all
platform.manage_features
enterprise.manage_members
enterprise.manage_roles
enterprise.manage_billing
project.create
project.edit
project.view
project.delete
point_map.use
export.advanced
order.view
```

```text
docs/account-tier-and-upgrade-plan.md:396
功能权限判断应同时检查账号类型、套餐限制和角色权限。
```

Documentation convention:

- Keep the output framework-neutral.
- Define contracts and examples, not implementation code tied to a specific backend.
- Use stable permission names in lowercase dotted form, matching the current document.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inspect document | `Get-Content -Raw -Encoding UTF8 docs/account-tier-and-upgrade-plan.md` | exits 0 and shows readable Chinese |
| Check contract section | `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "权限判断流程","拒绝原因","服务端" -Encoding UTF8` | finds the added permission contract |
| Check changed files | `git status --short` | shows only intended doc/plan files changed |

## Scope

**In scope**:

- `docs/account-tier-and-upgrade-plan.md`
- `plans/README.md`

**Out of scope**:

- Writing authorization middleware code
- Building UI screens
- Choosing a payment provider
- Defining every possible future permission not needed by the current tiers

## Git Workflow

- Branch: `codex/permission-contract-plan`
- Commit style: no existing commit convention. Use a clear message such as `docs: define permission evaluation contract`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a permission evaluation flow

Add a section named `## 权限判断流程`.

Define this order:

1. Authenticate user identity.
2. Check account status.
3. Resolve account type.
4. Resolve subscription and plan limits.
5. Resolve organization and role when the resource belongs to an enterprise.
6. Check resource ownership or organization membership.
7. Check atomic permission.
8. Return allow or deny with a machine-readable denial reason.

State explicitly that backend/server-side checks are authoritative. Frontend checks are only for display and user guidance.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "服务端权限判断为准|server|拒绝原因" -Encoding UTF8` -> exits 0 and finds the new rule.

### Step 2: Define denial reasons

Add machine-readable denial reasons for common gates:

```text
NOT_AUTHENTICATED
ACCOUNT_DISABLED
PLAN_REQUIRED
PROJECT_LIMIT_REACHED
POINT_MAP_NOT_INCLUDED
TEAM_FEATURE_REQUIRED
ROLE_PERMISSION_DENIED
RESOURCE_NOT_FOUND_OR_NOT_OWNED
SUBSCRIPTION_EXPIRED
PLATFORM_ADMIN_REQUIRED
```

For each denial reason, include:

- When it occurs
- Suggested user-facing action
- Whether it should show an upgrade CTA

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "PROJECT_LIMIT_REACHED|POINT_MAP_NOT_INCLUDED|ROLE_PERMISSION_DENIED" -Encoding UTF8` -> exits 0 and finds the denial reasons.

### Step 3: Add scenario examples

Add scenario examples for:

- Free user tries to create second project.
- Free user opens point map.
- Personal upgraded user tries to invite a team member.
- Enterprise child account tries to access a project without role permission.
- Enterprise owner tries to manage billing.
- Super admin manages a user's plan.

Each example should list input context, requested permission, expected result, and denial reason if denied.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "个人免费账号创建第 2 个项目","企业子账号","超级管理员" -Encoding UTF8` -> exits 0 and finds scenario examples.

## Test Plan

No automated tests exist. Manual verification:

- Every permission in the current permission list has a clear source: account type, plan limit, role, or ownership.
- Denial reasons cover every upgrade trigger named in the product document.
- Server-side authority is stated explicitly.

## Done Criteria

- [ ] The document contains a permission evaluation flow.
- [ ] The document contains machine-readable denial reasons.
- [ ] The document contains concrete scenario examples for free, personal upgraded, enterprise owner, enterprise child account, and super admin.
- [ ] No source code is modified.
- [ ] `plans/README.md` status row for Plan 003 is updated.

## STOP Conditions

Stop and report back if:

- Plan 002 has not defined organization membership and subscription ownership.
- The product owner wants permissions enforced only in frontend UI.
- A requested permission depends on an undefined feature outside the current account-tier scope.

## Maintenance Notes

When code implementation begins, this contract should become shared tests around authorization middleware or policy functions. Reviewers should reject feature-specific permission checks that bypass this flow for point maps, project creation, enterprise membership, billing, or platform admin actions.
