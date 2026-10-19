# Plan 004: Design the upgrade and billing journey

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git status --short -- docs/account-tier-and-upgrade-plan.md plans/004-upgrade-and-billing-journey.md`
> If `docs/account-tier-and-upgrade-plan.md` has changed since this plan was written, compare the "Current state" excerpts below against the live document before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-acceptance-ready-account-rules.md`, `plans/002-account-organization-subscription-data-model.md`, `plans/003-permission-evaluation-contract.md`
- **Category**: direction
- **Planned at**: `uncommitted-initial-state`, 2026-06-28

## Why This Matters

The current document includes prices and upgrade triggers, but a paid plan needs more than a pricing table. Users must know when they are blocked, what plan unlocks the action, how existing data is preserved, what happens on expiration, and how personal paid time converts during enterprise upgrade. This plan turns pricing into a usable billing and upgrade journey.

## Current State

Relevant file:

- `docs/account-tier-and-upgrade-plan.md` — contains package design and upgrade paths.

Important excerpts:

```text
docs/account-tier-and-upgrade-plan.md:122
## 4. 套餐设计
...
月付：¥39 / 月
年付：¥399 / 年
基础企业版：¥199 / 月，包含 5 个成员
企业年付：¥1999 / 年，包含 5 个成员
额外成员：¥29 / 人 / 月
```

```text
docs/account-tier-and-upgrade-plan.md:211
## 5. 升级路径

### 5.1 免费版升级到个人升级版
...
### 5.2 免费版升级到企业版
...
### 5.3 个人升级版升级到企业版
```

```text
docs/account-tier-and-upgrade-plan.md:251
升级规则：

- 保留个人项目
- 可将个人项目迁移到企业空间
- 已支付个人版剩余时长可折算为企业版抵扣金额
```

Documentation convention:

- Keep the output in Chinese.
- Keep pricing as "建议价格" unless product owner confirms final commercial pricing.
- Avoid naming a payment provider unless a provider has been selected.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inspect document | `Get-Content -Raw -Encoding UTF8 docs/account-tier-and-upgrade-plan.md` | exits 0 and shows readable Chinese |
| Check billing sections | `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "订阅状态","升级流程","降级规则","抵扣" -Encoding UTF8` | finds the added billing journey |
| Check changed files | `git status --short` | shows only intended doc/plan files changed |

## Scope

**In scope**:

- `docs/account-tier-and-upgrade-plan.md`
- `plans/README.md`

**Out of scope**:

- Payment provider implementation
- Invoice tax compliance details
- Refund policy legal wording
- External pricing research

## Git Workflow

- Branch: `codex/upgrade-billing-journey`
- Commit style: no existing commit convention. Use a clear message such as `docs: specify upgrade and billing journey`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define subscription states

Add a section named `## 订阅与付费状态`.

Include:

- `FREE`
- `ACTIVE`
- `GRACE_PERIOD`
- `EXPIRED`
- `CANCELED`
- `PAST_DUE` if payment failure is in scope

For each state, define:

- User access level
- Whether new projects can be created
- Whether point map can be used
- Whether team/member changes are allowed
- Whether upgrade CTA should be shown

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "GRACE_PERIOD|PAST_DUE|CANCELED" -Encoding UTF8` -> exits 0 and finds subscription states.

### Step 2: Define upgrade flows

For each upgrade path, add a step-by-step flow:

- Free to personal upgraded
- Free to enterprise
- Personal upgraded to enterprise

Each flow should include:

- Trigger
- Paywall or upgrade prompt
- Plan selection
- Payment result
- Account/organization/subscription update
- Data preservation rule
- Failure behavior

Include the remaining-time credit rule for personal upgraded to enterprise, but label it as a product/business rule requiring final finance approval if exact calculation is not decided.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "免费版升级到个人升级版流程","个人升级版升级到企业版流程","剩余时长" -Encoding UTF8` -> exits 0 and finds flow details.

### Step 3: Define downgrade and cancellation behavior

Add rules for:

- Personal upgraded downgrades to free.
- Enterprise downgrades or expires.
- Enterprise member count exceeds included seats after downgrade.
- Projects exceed free plan quota after downgrade.
- Point map data exists but the current plan does not include point map access.

Recommended default:

- Preserve data.
- Lock editing/creation for out-of-plan resources.
- Allow read-only access where reasonable.
- Show upgrade CTA on blocked premium actions.

**Verify**: `Select-String -Path docs/account-tier-and-upgrade-plan.md -Pattern "降级规则","只读","超出套餐" -Encoding UTF8` -> exits 0 and finds downgrade rules.

## Test Plan

No automated tests exist. Manual verification:

- Every upgrade trigger in the original document maps to a flow.
- Every subscription state has clear access behavior.
- Downgrade behavior preserves user data and defines feature locks.
- Billing language avoids committing to a payment provider.

## Done Criteria

- [ ] The document contains subscription states and access behavior.
- [ ] The document contains step-by-step upgrade flows.
- [ ] The document contains downgrade and cancellation behavior.
- [ ] Remaining-time credit is documented as a business rule requiring final calculation approval.
- [ ] `plans/README.md` status row for Plan 004 is updated.

## STOP Conditions

Stop and report back if:

- The product owner has already selected a payment provider and expects provider-specific flows.
- Legal/finance policy is required to define refunds, invoices, or taxes.
- Plan 003 has not defined denial reasons for upgrade-triggering gates.

## Maintenance Notes

When the app is implemented, every paywall should map to a denial reason from Plan 003 and a flow from this plan. Reviewers should verify that downgrade and expiration behavior never deletes customer data silently.
