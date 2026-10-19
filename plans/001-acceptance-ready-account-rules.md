# Plan 001: Turn account tiers into acceptance-ready product rules

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git status --short -- docs/account-tier-and-upgrade-plan.md plans/001-acceptance-ready-account-rules.md`
> If `docs/account-tier-and-upgrade-plan.md` has changed since this plan was written, compare the "Current state" excerpts below against the live document before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: `uncommitted-initial-state`, 2026-06-28

## Why This Matters

The existing account-tier document explains the intended tiers, but it does not yet give implementers a clear checklist for what must be true when the feature is done. That creates room for inconsistent interpretations, especially around free-plan limits, enterprise child accounts, expired subscriptions, and project ownership transfer. This plan turns the prose into acceptance-ready product rules without changing the core business intent.

## Current State

Relevant file:

- `docs/account-tier-and-upgrade-plan.md` — current product document for account levels, permissions, pricing, upgrade paths, and implementation suggestions.

Important excerpts:

```text
docs/account-tier-and-upgrade-plan.md:289
## 7. 关键产品规则

- 免费版最多只能创建 1 个项目。
- 免费版不能使用点位图。
- 个人升级版可以使用点位图，但不能创建团队和子账号。
- 企业版主账号可以创建团队和子账号。
- 企业版子账号的功能由角色权限决定。
- 超级管理员可以管理所有账号、套餐、平台功能和订单。
- 企业版账号到期后，进入宽限期，宽限期内可查看数据但限制新增和编辑。
- 免费版升级后，原有项目和数据保留。
- 企业主账号删除子账号时，子账号创建的数据应转交给企业主账号或指定管理员。
```

```text
docs/account-tier-and-upgrade-plan.md:301
## 8. 建议开发优先级

第一阶段：

- 账号等级字段
- 免费版项目数量限制
- 点位图权限限制
- 个人升级版付费入口
- 超级管理员账号管理
```

Documentation convention:

- Keep the document in Chinese.
- Use concise product language with tables where comparisons matter.
- Do not remove the existing account tiers or proposed pricing unless the product owner explicitly asks for a business change.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inspect document | `Get-Content -Raw -Encoding UTF8 docs/account-tier-and-upgrade-plan.md` | exits 0 and shows readable Chinese |
| Check changed files | `git status --short` | shows only intended doc/plan files changed |
| Search acceptance section | `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "验收标准","边界规则","状态流转" -Encoding UTF8` | finds the new sections |

## Scope

**In scope**:

- `docs/account-tier-and-upgrade-plan.md`
- `plans/README.md`

**Out of scope**:

- Creating app source code
- Creating database migrations
- Changing prices without product-owner approval
- Adding external market research

## Git Workflow

- Branch: `codex/account-tier-rules`
- Commit style: no existing commit convention. Use a clear message such as `docs: clarify account tier acceptance rules`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a product acceptance criteria section

Add a new section after "关键产品规则" named `## 8. 验收标准` and renumber later sections if necessary.

Include acceptance criteria for:

- Free personal account can create exactly one project and is blocked from creating a second project.
- Free personal account cannot access point map features.
- Personal upgraded account can use point maps and multiple projects but cannot create teams or subaccounts.
- Enterprise owner can create and manage subaccounts.
- Enterprise member access is limited by assigned role.
- Super admin can manage platform-level accounts, plans, features, and orders.
- Expired enterprise accounts enter a grace period with read-only behavior for new/edit operations.
- Deleted or removed enterprise child-account data is reassigned to the enterprise owner or selected admin.

Use checkbox-style acceptance criteria in Chinese, for example:

```markdown
## 8. 验收标准

- [ ] 个人免费账号创建第 2 个项目时，系统阻止创建并展示升级入口。
```

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "验收标准" -Encoding UTF8` -> exits 0 and returns the new heading.

### Step 2: Add boundary and edge-case rules

Add a subsection under the new acceptance area named `### 边界规则`.

Cover these edge cases:

- What happens when a user downgrades from personal upgraded to free while having more than one project.
- What happens when an enterprise plan expires.
- What happens when an enterprise owner removes a child account.
- Whether enterprise members can belong to multiple enterprises in v1. If the product owner has not decided, state v1 supports one enterprise per member and mark multi-enterprise as future scope.
- How project limits are counted: active projects only, or active plus archived. If undecided, choose active projects only and note archived projects cannot be edited in free mode unless restored within quota.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "边界规则" -Encoding UTF8` -> exits 0 and returns the subsection.

### Step 3: Add a phase-by-phase delivery checklist

Improve the existing "建议开发优先级" section so each phase has:

- Goal
- Included capabilities
- Done criteria

Do not change the phase order unless the product owner has approved a different roadmap.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "Done|完成标准|交付目标" -Encoding UTF8` -> exits 0 and returns the delivery checklist text.

## Test Plan

No automated test suite exists in this repository yet. Verify manually by reading the document and checking:

- Every account tier has at least one explicit acceptance criterion.
- Every paid/free restriction named in the original document appears in acceptance criteria.
- Edge cases do not contradict the original key rules.

## Done Criteria

- [ ] `docs/account-tier-and-upgrade-plan.md` contains a `验收标准` section.
- [ ] The document contains explicit boundary rules for downgrade, expiration, child-account removal, and project limit counting.
- [ ] `git status --short` shows no unrelated source files modified.
- [ ] `plans/README.md` status row for Plan 001 is updated.

## STOP Conditions

Stop and report back if:

- The product owner changes the tier names or pricing model while this plan is in progress.
- The current document no longer contains the sections shown in "Current state".
- Clarifying an edge case would require a business decision that cannot be reasonably inferred from the existing document.

## Maintenance Notes

Future backend, frontend, and billing plans should reference these acceptance criteria instead of reinterpreting the original prose. Reviewers should check that added edge-case rules preserve the original distinction between personal upgraded accounts and enterprise accounts.
