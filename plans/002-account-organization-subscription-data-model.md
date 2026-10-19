# Plan 002: Design the account, organization, role, and subscription data model

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git status --short -- docs/account-tier-and-upgrade-plan.md plans/002-account-organization-subscription-data-model.md`
> If `docs/account-tier-and-upgrade-plan.md` has changed since this plan was written, compare the "Current state" excerpts below against the live document before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-acceptance-ready-account-rules.md`
- **Category**: architecture
- **Planned at**: `uncommitted-initial-state`, 2026-06-28

## Why This Matters

The product document correctly separates account type and package type, but it does not yet define entity boundaries. Without a concrete model, implementation may collapse user identity, enterprise membership, role permissions, and billing state into one account field. That would make enterprise child accounts, plan changes, and future pricing migrations painful.

## Current State

Relevant file:

- `docs/account-tier-and-upgrade-plan.md` — contains product-level implementation suggestions.

Important excerpts:

```text
docs/account-tier-and-upgrade-plan.md:329
### 9.1 账号类型枚举

SUPER_ADMIN
ENTERPRISE_OWNER
ENTERPRISE_MEMBER
PERSONAL_PRO
PERSONAL_FREE
```

```text
docs/account-tier-and-upgrade-plan.md:341
### 9.2 套餐类型枚举

建议套餐和账号类型分开，避免后续套餐变化影响权限判断。
```

```text
docs/account-tier-and-upgrade-plan.md:354
### 9.3 企业关系字段

- enterprise_id：企业 ID
- owner_user_id：企业主账号 ID
- parent_user_id：创建该子账号的账号 ID
- role_id：企业内角色 ID
- status：账号状态
```

Documentation convention:

- Keep the output in Chinese.
- Prefer tables for entity fields.
- Keep implementation choices framework-neutral unless a real app scaffold exists.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inspect document | `Get-Content -Raw -Encoding UTF8 docs/account-tier-and-upgrade-plan.md` | exits 0 and shows readable Chinese |
| Check model sections | `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "数据模型","实体关系","状态枚举" -Encoding UTF8` | finds the added model sections |
| Check changed files | `git status --short` | shows only intended doc/plan files changed |

## Scope

**In scope**:

- `docs/account-tier-and-upgrade-plan.md`
- `plans/README.md`

**Out of scope**:

- Actual database schema files
- ORM-specific syntax
- Payment provider integration code
- Authentication implementation

## Git Workflow

- Branch: `codex/account-data-model-plan`
- Commit style: no existing commit convention. Use a clear message such as `docs: define account data model`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a data model section

Add a section after the current "开发实现建议" content named `## 数据模型建议` or update the existing implementation section to include explicit entities.

Define these entities:

- `User` / 用户：identity and login profile.
- `AccountProfile` / 账号档案：account type and user-facing status.
- `Organization` / 企业组织：enterprise-level container.
- `OrganizationMember` / 企业成员：membership between user and organization.
- `Role` / 角色：role name and scope.
- `Permission` / 权限点：atomic capability.
- `Plan` / 套餐：commercial package and limit configuration.
- `Subscription` / 订阅：current paid/free subscription state.
- `Project` / 项目：owned either by a personal user or enterprise organization.

For each entity, include a table with required fields, field meaning, and notes.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "OrganizationMember|企业成员|Subscription|订阅" -Encoding UTF8` -> exits 0 and finds the new content.

### Step 2: Define relationships and ownership rules

Add a relationship subsection that states:

- One user has one account profile.
- One enterprise organization has one owner user.
- One organization has many organization members.
- One organization member has one role at v1 scope.
- A personal project belongs to a user.
- An enterprise project belongs to an organization.
- A subscription belongs to either a user for personal plans or an organization for enterprise plans.

Add explicit v1 assumptions:

- One enterprise member belongs to one enterprise by default.
- Multi-organization membership is future scope unless the product owner requests it now.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "一个企业组织","个人项目","企业项目" -Encoding UTF8` -> exits 0 and returns relationship rules.

### Step 3: Define lifecycle status enums

Add status enums for:

- User/account status: active, disabled, deleted.
- Subscription status: free, trialing if applicable, active, grace_period, expired, canceled.
- Organization member status: invited, active, disabled, removed.
- Project status: active, archived, deleted.

Use Chinese labels and machine-friendly enum values.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "grace_period|invited|archived" -Encoding UTF8` -> exits 0 and finds the enum values.

## Test Plan

No automated test suite exists. Manual verification:

- Every account tier can be represented by the model.
- Enterprise owner and child account are represented without duplicating user identity.
- Personal and enterprise subscriptions are represented separately.
- Project ownership can distinguish personal projects from enterprise projects.

## Done Criteria

- [ ] The document contains explicit entity tables for user, organization, member, role, permission, plan, subscription, and project.
- [ ] The document contains relationship rules.
- [ ] The document contains lifecycle status enums.
- [ ] No app source code or database migration files are created.
- [ ] `plans/README.md` status row for Plan 002 is updated.

## STOP Conditions

Stop and report back if:

- Plan 001 has not clarified acceptance rules and the data model would depend on unresolved edge cases.
- The product owner wants enterprise members to belong to multiple enterprises in v1.
- The product owner wants one login account to hold multiple simultaneous personal/enterprise profiles.

## Maintenance Notes

When an implementation stack is chosen, convert this model into migrations and types without changing the product vocabulary. Reviewers should pay special attention to avoiding account-type checks where subscription or role checks are the real business rule.
