# Plan 011: 把展示首页改成独立官网首页并加入套餐计划

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 97dae55..HEAD -- app/showcase components/marketing components/app-sidebar.tsx app/layout.tsx app/page.tsx public/assets`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/012-protocol-logo-asset-pack.md`
- **Category**: direction / UI
- **Planned at**: commit `97dae55`, 2026-06-28

## Why this matters

The current 展示首页 is rendered inside the logged-in admin shell, so it feels like another internal tool page instead of a public website. FMKJ needs a separate official-looking marketing homepage with product story, smart-home protocol credibility, and pricing plans, while the sidebar should stay focused on operational work.

## Current state

- `app/showcase/page.tsx` wraps `ShowcaseHome` with `AppSidebar`, `SiteHeader`, `SidebarProvider`, and `SidebarInset`, so the page appears inside the backend navigation.
- `components/app-sidebar.tsx` includes a `展示首页` nav item in `navGeneral`, which puts marketing content inside daily operator navigation.
- `components/marketing/showcase-home.tsx` contains the current page, but its copy has mojibake in several strings and the layout is card-heavy.
- `app/page.tsx` is the authenticated operations dashboard. Do not turn `/` into a public page unless product owner explicitly accepts moving the app dashboard to `/dashboard`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 errors |
| Build | `pnpm build` | Next.js build succeeds |

## Scope

**In scope**:
- `app/showcase/page.tsx`
- `components/marketing/showcase-home.tsx`
- `components/marketing/**` new marketing-only components
- `components/app-sidebar.tsx`
- public protocol/product assets used by the homepage

**Out of scope**:
- Changing authenticated dashboard route `/`.
- Implementing checkout/payment.
- Changing account permission logic.
- Changing database schema.

## Steps

### Step 1: Remove 展示首页 from backend sidebar

Remove the `/showcase` item from `components/app-sidebar.tsx`. If operators still need access, add a small external-link action in the user menu or settings later; do not keep it as a primary sidebar item.

**Verify**: `pnpm typecheck` exits 0.

### Step 2: Make `/showcase` a standalone public website route

Rewrite `app/showcase/page.tsx` so it renders only the marketing page component, without `SidebarProvider`, `AppSidebar`, `SidebarInset`, or `SiteHeader`.

Add a marketing header inside `ShowcaseHome`:

- left: `FMKJ`
- nav: 产品能力, 协议生态, 套餐计划, 适用场景
- actions: `登录后台` -> `/login`, `进入工作台` -> `/`

The header should be sticky or top-aligned, public-site style, and independent from backend sidebar.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Redesign homepage content

Rewrite `components/marketing/showcase-home.tsx` with clear Chinese copy and a more official website structure:

- First viewport hero: brand/product signal `FMKJ 全屋智能项目管理系统`, one concise value prop, product image/background using real product assets, CTA buttons.
- Product capability band: 项目流程, 点位图, 产品库, 方案报价, 工单交付, 团队权限.
- Protocol ecosystem band: use the real protocol logo component from Plan 012.
- Workflow band: 从线索到交付的 5-step process.
- Pricing band: 免费版, 个人升级版, 企业版, with feature limits matching existing account rules.
- Trust/operations band: use real product images already in `public/assets/products`.
- Final CTA.

Avoid nested cards and avoid making every section a floating card. Use full-width bands with constrained inner content. Cards are acceptable for repeated pricing plan items.

**Verify**: `pnpm build` succeeds.

### Step 4: Add pricing plan content

Add a static pricing section with:

- 个人免费版: 1 个项目, 不含点位图, 适合试用.
- 个人升级版: 多项目, 点位图, 高级导出, 无团队/子账号.
- 企业版: 团队/子账号, 角色权限, 企业项目, 优先支持.

Use labels such as `建议价` if exact price is not persisted yet. Do not imply payment is already wired unless Plan 008/004 is implemented.

**Verify**: visually inspect `/showcase` in desktop and mobile.

## Test plan

- Add lightweight component tests only if the project already has React component test setup; otherwise rely on typecheck/build and browser verification.
- Manual checks:
  - `/showcase` has no backend sidebar.
  - `/showcase` has pricing plans.
  - Sidebar no longer contains 展示首页.
  - CTA links work.

## Done criteria

- [ ] `/showcase` is a standalone public website page.
- [ ] Backend sidebar no longer contains 展示首页.
- [ ] Homepage includes protocol ecosystem and 套餐计划 sections.
- [ ] Chinese copy is readable, not mojibake.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass.

## STOP conditions

Stop and report if the product owner wants `/` to become the public website because that requires deciding where authenticated dashboard should live.

## Maintenance notes

Future marketing pages should live under `components/marketing/**` and stay independent from `AppSidebar`. Keep pricing text aligned with Plan 008 once persisted plan prices exist.
