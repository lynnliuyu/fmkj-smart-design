# Plan 012: 收集真实智能家居协议 logo 并替换滚动图标

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat 97dae55..HEAD -- components/marketing components/ui/marquee.tsx public/assets/protocols public/assets`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction / UI / docs
- **Planned at**: commit `97dae55`, 2026-06-28

## Why this matters

The current protocol marquee uses generic lucide icons, so it does not look like a credible smart-home ecosystem section. Replacing them with real protocol and ecosystem logos makes the public homepage feel specific to the industry rather than template-like.

## Current state

- `components/marketing/showcase-home.tsx` defines `protocolRows` with icon components such as `Network`, `Radio`, `Wifi`, and `Bluetooth`.
- `components/ui/marquee.tsx` already supports grayscale hover behavior and can keep being used.
- `public/assets/products` already contains many real product images, but there is no `public/assets/protocols` directory or protocol-logo manifest.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm test` | all tests pass |
| Lint | `pnpm lint` | exit 0 errors |
| Build | `pnpm build` | Next.js build succeeds |

## Scope

**In scope**:
- `public/assets/protocols/**`
- `components/marketing/protocol-marquee.tsx`
- `components/marketing/showcase-home.tsx`
- optional `public/assets/protocols/manifest.json`

**Out of scope**:
- Scraping unknown websites without checking usage rights.
- Replacing product library images.
- Adding runtime remote image dependencies for the marquee.

## Steps

### Step 1: Create a protocol asset manifest

Create `public/assets/protocols/manifest.json` listing each asset:

- `name`
- `file`
- `sourceUrl`
- `sourceName`
- `usageNote`

Target logos:

- Matter
- Zigbee
- Thread
- Wi-Fi
- Bluetooth
- Apple Home
- KNX
- DALI
- Modbus
- PoE
- Aqara
- 米家 / Xiaomi Home

Prefer official brand/standard pages or well-known open icon sets with clear license. If a logo cannot be safely used, use a text badge and record why in `usageNote`.

**Verify**: `Get-Content public/assets/protocols/manifest.json` shows valid JSON.

### Step 2: Add optimized local logo files

Store SVG or transparent PNG files under `public/assets/protocols/`. Keep each file reasonably small. Use consistent filenames such as `matter.svg`, `zigbee.svg`, `thread.svg`.

Do not hotlink remote images. Do not store downloaded files with unclear filenames.

**Verify**: `Get-ChildItem public/assets/protocols` shows the expected files.

### Step 3: Build a reusable protocol marquee component

Create `components/marketing/protocol-marquee.tsx` that reads a local array or manifest-derived data and renders `Marquee` rows with `next/image` or inline SVG-safe `img` tags.

Each item should show:

- logo
- protocol/ecosystem name
- short Chinese capability description

Keep grayscale hover and ensure logos are readable in light and dark themes.

**Verify**: `pnpm typecheck` exits 0.

### Step 4: Replace generic icons in homepage

Update `ShowcaseHome` to use the new protocol marquee instead of the lucide-icon `protocolRows`.

**Verify**: `pnpm build` succeeds and browser inspection shows real logo images, not lucide icons.

## Test plan

- Manual desktop/mobile checks for marquee readability.
- Inspect rendered HTML to confirm assets are local `/assets/protocols/...`.
- Verify reduced motion remains acceptable through existing marquee CSS.

## Done criteria

- [ ] Real protocol/ecosystem assets exist under `public/assets/protocols`.
- [ ] Every asset has source/license notes in manifest.
- [ ] Homepage protocol marquee uses real assets.
- [ ] No remote image hotlinks are used.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` pass.

## STOP conditions

Stop and report if a requested logo has no safe source or trademark usage is unclear. Use a text-only badge rather than inventing or tracing a protected logo.

## Maintenance notes

Protocol logos are brand assets. Keep source notes with the files so future maintainers can replace or remove them if brand guidelines change.
