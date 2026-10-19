# Release candidate validation

Date: 2026-10-19 (Asia/Shanghai)
Target: lynnliuyu/fmkj-smart-design
Environment: macOS arm64, Node.js 24.21.0, pnpm 12.8.1. Node.js 22 CI has not yet been observed remotely.

## Checks actually run on the sanitized source

- `pnpm install --offline --frozen-lockfile`: passed; reused the local store, downloaded 0 packages.
- `pnpm typecheck`: passed.
- `pnpm test`: 85 test files, 868 tests passed.
- `pnpm lint`: passed with 0 errors and 9 existing warnings (image rendering, effect refs, two unused variables).
- `pnpm build`: passed using the default Next.js 16.1.6 Turbopack build, without real environment values; 62 pages generated. The middleware-to-proxy deprecation warning remains.
- `pnpm icons:build` followed by `git diff --exit-code -- public/assets/point-icons`: passed; 44 icons reproduced without drift.
- Python source compilation in memory (5 files) and Node syntax checks (26 modules): passed without retaining bytecode.
- `bash -n setup.sh`: passed. A disposable harness with a mock installer verified frozen-install arguments, operation from a different working directory, 0600 random AUTH_SECRET creation, no secret logging, no overwrite on the second invocation, and a clear unsupported-pnpm diagnostic. No database or service was started by setup.
- Temporary production HTTP check: login 200; unauthenticated projects and root placeholder redirected 307; unauthenticated attachments/products APIs returned 401; the neutral Matter SVG returned 200. The temporary service was terminated afterward. This is a startup/access-guard smoke check, not an authenticated business workflow test.

## Fixes validated

The health-check configuration and admin label now use the same AUTH_SECRET as session signing. Two regression assertions failed against the old configuration and passed after the fix. The suite includes the check that obsolete JWT_SECRET cannot satisfy readiness.
The setup version-error message uses a braced shell variable so adjacent Chinese punctuation cannot cause an unbound-variable error; the unsupported-version harness verified the actual diagnostic.

## Not yet verified

Docker daemon was not running. No fresh PostgreSQL migration/seed or Docker-image acceptance was claimed. No real customer data was used; authenticated browser workflows, optional external CAD/PDF tooling, actual customer exports and all transitive dependency license conditions were not fully validated. Public Blob URLs and production messaging limitations are documented in README/SECURITY.

## Packaging hygiene

Only sanitized source, neutral SVGs, templates and documentation are intended for publication. Verification-only dependencies, build artifacts, bytecode and generated type caches were removed before final sanitization. The original business checkout, database and stopped development service were left unchanged.
