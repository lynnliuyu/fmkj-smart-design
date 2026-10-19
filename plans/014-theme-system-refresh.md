# Plan 014: 按 shadcn 风格重做主题 token 和主题抽屉

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 97dae55..HEAD -- app/globals.css components/theme-style-drawer.tsx components/theme-provider.tsx components/site-header.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: UI / tech-debt
- **Planned at**: commit `97dae55`, 2026-06-28

## Why this matters

The current theme drawer only changes a few variables, so the UI can feel unfinished: primary color shifts but charts, sidebar, muted surfaces, cards, and dark mode do not become a coherent theme. A shadcn-style theme should be a complete token preset that updates background, foreground, primary, accent, sidebar, chart colors, radius, and density together.

## Current state

- `app/globals.css` defines shadcn/Tailwind CSS variables for root and dark themes.
- `components/theme-style-drawer.tsx` stores `ui-accent`, `ui-radius`, and `ui-density`, but only mutates `--primary`, `--sidebar-primary`, `--ring`, and `--radius`.
- Labels in `components/theme-style-drawer.tsx` contain mojibake.
- Official shadcn examples emphasize customizable CSS variables, blocks, sidebar layouts, and Recharts-compatible chart tokens.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 errors |
| Build | `pnpm build` | Next.js build succeeds |

## Scope

**In scope**:
- `app/globals.css`
- `components/theme-style-drawer.tsx`
- optional small theme helper under `lib/theme-presets.ts`

**Out of scope**:
- Installing a new UI library.
- Replacing shadcn/ui components.
- Redesigning every page in the same PR.

## Steps

### Step 1: Define complete theme presets

Create theme presets such as:

- `neutral`: close to shadcn default, professional backend.
- `zinc`: cooler gray, closest to shadcn examples.
- `slate-blue`: smart-home technical accent, restrained.
- `green`: operations/health accent, restrained.

Each preset should define light and dark values for:

- `--primary`
- `--primary-foreground`
- `--accent`
- `--muted`
- `--ring`
- `--sidebar`
- `--sidebar-primary`
- `--sidebar-accent`
- `--chart-1` through `--chart-5`

Avoid one-note palettes. Do not make the app overwhelmingly purple, beige, brown, or dark blue.

**Verify**: `pnpm typecheck` exits 0.

### Step 2: Update the theme drawer UI

Rewrite `components/theme-style-drawer.tsx` labels in readable Chinese:

- 模式: 浅色, 深色, 跟随系统
- 主题: Neutral, Zinc, Slate Blue, Green
- 圆角: 直角, 小, 默认, 柔和
- 密度: 紧凑, 默认, 宽松
- 预览

Show a richer preview with sidebar strip, card, button, badge, and mini chart swatches so users can understand the full preset.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Apply full preset variables safely

When a preset changes, set all token variables on `document.documentElement`. Keep localStorage keys backwards compatible or migrate old `ui-accent` to the new preset key.

Ensure dark mode uses dark preset values. Do not hard-code only light values.

**Verify**: switch themes manually in browser and confirm sidebar, cards, charts, and buttons change coherently.

### Step 4: Align global CSS defaults

Update `app/globals.css` default root/dark tokens to a polished baseline that matches the chosen default preset. Keep shadcn variable names intact.

**Verify**: `pnpm build` succeeds.

## Test plan

- Existing tests should pass.
- Manual browser checks in light/dark/system modes.
- Check dashboard, product page, quote page, and public `/showcase` for readability.

## Done criteria

- [ ] Theme drawer text is readable Chinese.
- [ ] Theme presets update full token sets, not only primary color.
- [ ] Sidebar, charts, cards, buttons, and rings look coherent in light and dark.
- [ ] Existing shadcn/ui components remain compatible.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass.

## STOP conditions

Stop and report if changing theme variables breaks third-party component contrast or if page-level hard-coded colors prevent a coherent theme without broader refactoring.

## Maintenance notes

Future page designs should use semantic tokens (`bg-background`, `text-muted-foreground`, `bg-card`, chart variables) instead of hard-coded one-off colors, otherwise theme presets will drift.
