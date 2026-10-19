# Sanitization Report: fmkj-smart-design

> 历史记录：本报告记录首次 GPL-3.0 发布时的状态。项目所有者随后于 2026-10-19 将项目自有代码改为 MIT；当前许可见根目录 LICENSE。第三方许可保持各自声明。

**Date:** 2026-10-19 (Asia/Shanghai)
**Auditor:** opensource-sanitizer v1.0.0
**Verdict:** PASS WITH WARNINGS
**Audited source snapshot:** `664f0cf`, one root commit and 572 tracked files before this report update.
**Scope:** final packaged source candidate; all seven categories independently rechecked. This audit did not install dependencies, start services, connect to a database, mutate Git, or change source/configuration.

## Summary

| Category | Status | Findings |
|----------|--------|----------|
| Secrets | PASS | 0 confirmed secret leaks; example/test/development constants reviewed |
| PII | PASS | 0 confirmed private identifiers; 3 synthetic phone fixture matches reviewed |
| Internal References | PASS | 0 personal absolute paths, secret-directory references, or private infrastructure addresses |
| Dangerous Files | PASS | 0 forbidden files/directories; 3 sanitized environment example templates allowed |
| Config Completeness | PASS | All supported user configuration documented in templates plus linked environment reference |
| Git History | PASS | 1 root commit, 1 branch, no remotes, no unreachable objects; fsck exit 0 |
| Unreadable Files | PASS | 0 findings; full content-based procedure completed successfully |

## Critical Findings (Must Fix Before Release)

None confirmed. No critical file/line locations to report. This is a source sanitization result, not a full security or third-party rights certification.

## Warnings (Review Before Release)

1. **[DEPENDENCY / RIGHTS SCOPE]** `THIRD_PARTY_NOTICES.md` explicitly limits its checked package declarations and does not claim all direct/transitive dependencies are audited. It distinguishes the upstream historical GPL identifier from the project's GPL-3.0-only selection and records the MPL dependency separately. Before distributing dependency copies, binaries, or containers, review actual contents and preserve required notices/source access. Neutral project SVGs and protocol-name badges do not grant trademark, font, CAD/PDF tool, or other third-party redistribution rights. No private customer drawings or product-photo library is included in this candidate.
2. **[PRODUCTION SAFETY LIMITS]** README and SECURITY disclose that attachment uploads generate public Blob URLs, SMS/email providers are not configured for production, and development authentication/database defaults must not be reused in production. These are existing implementation limits, not leaked online credentials. Confidential production deployments require storage access control and the other deployment safeguards described there.
3. **[UNVERIFIED ACCEPTANCE / CI]** This auditor performed static sanitization and Git checks only. The parent agent reports 868 tests across 85 files, typecheck/build/icon checks, setup mocks, and lint with 0 errors/9 warnings passing locally; these results were not rerun here. The Node.js 22 Linux workflow in `.github/workflows/ci.yml` has not run remotely for the new repository. Real browser business flows, a fresh Docker/database end-to-end installation, persisted fixed delivery versions, and actual customer-file exports remain outside this audit and must not be claimed complete from local checks.

## Unreadable Files

**Unreadable count: 0**

The complete Step 7 shell script from the auditor procedure was actually executed, without substituting an extension-based inventory. It completed both find passes and printed `Unreadable count: 0`; the shell exit status was 0. No type tally or scan problem was emitted. The sidecar manifest is absent and was never read or printed.

Classification used first-byte signatures, whole-file control-byte checks, and file MIME/encoding checks. The text scan independently read all 572 candidate files, including hidden files, LICENSE, new packaging/onboarding/security/configuration documents, setup script, Issue templates, SVGs, scripts, and lockfile. No symlinks were present. Git internals are excluded by Step 7 and were audited separately in the history category.

## .env.example Audit

- Primary entries: `DATABASE_URL`, `DATABASE_SSL`, `PRODUCTS_TABLE`, `AUTH_SECRET`, `AUTH_DEV_MODE`, `BLOB_READ_WRITE_TOKEN`; `AUTH_INITIAL_ADMIN` is a commented optional example.
- The template links `docs/environment.md`, which covers the remaining **24** optional/alternative keys. The initial audit incorrectly called its 24-item list 25; that counting error is corrected here.
- Product/API keys (5): `PRODUCTS_LIMIT`, `FMKJ_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `FMKJ_API_TOKEN`, `DEV_AUTH_TOKEN`.
- Bootstrap/tooling keys (7): `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `CADCRAFT_CLI`, `CAD_REVIEW_PYTHON`, `PDFTOPPM`, `EXPECTED_GITHUB_REPO`, `NEXT_PUBLIC_APP_VERSION`.
- Database/Compose alternatives (12): `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `PGHOST`, `POSTGRES_HOST`, `PGUSER`, `POSTGRES_USER`, `PGPASSWORD`, `POSTGRES_PASSWORD`, `PGDATABASE`, `POSTGRES_DATABASE`, `POSTGRES_DB`, `POSTGRES_PORT`.
- Variables missing from both the templates and linked documentation: **none**. Optional alternatives are documented with purpose/defaults rather than populated with unnecessary sample secrets.
- Variables in `.env.example` absent from implementation: **none**, counting the optional commented administrator entry.
- `NODE_ENV`, platform-supplied `VERCEL`/`VERCEL_GIT_COMMIT_SHA`, normal inherited `PYTHONPATH`, shell `BASH_SOURCE`, Docker process settings, and ordinary system executable locations do not require manufactured user-secret configuration.
- Dynamic `process.env` reads were reviewed: application database aliases and health-check key groups are explicitly covered; script loaders preserve externally supplied values. SQL/UI template-literal substitutions are not environment reads.
- `lib/platform-health.ts:64` and `app/admin/_components/operations-views.tsx:186` now use `AUTH_SECRET`, matching `lib/session-secret.ts:4`. Obsolete `JWT_SECRET` only remains as an explicit negative regression fixture in `tests/platform-health.test.ts`; it is not a production setting to add.
- `.env.local.example` and `.env.production.example` are sanitized templates. No actual `.env`, local/production environment file, private certificate/key/service account, source map, dependency tree, Python cache, virtual environment, session folder, database dump, or runtime build output was present.
- Database Compose uses parameter expansion for database identity/password/port and binds its disposable development database to loopback. Application Compose loads an absent private production environment file and contains ordinary process settings, not live credentials.

## Reviewed Pattern Matches

- `tests/platform-health.test.ts:13`, `:24`, and `:28`: documented example database URL, used in positive/negative tests and redaction assertions.
- `tests/platform-health.test.ts:14` and `:29`: fake signing values, including the explicit obsolete-key regression fixture. No test value is reproduced here.
- `tests/project-workflow.test.ts:38`, `:192`, and `:208`: synthetic phone-shaped test fixtures; no evidence of real customer contact data.
- `app/admin/_components/operations-views.tsx:181` and `:186`: UI translation labels mistaken for assignments by the broad heuristic, not stored tokens/secrets.
- `lib/session-secret.ts:1`: clearly named development session constant; returned only under the explicit development condition, while missing production `AUTH_SECRET` throws.
- `app/api/products/route.ts:153`: explicit local development HTTP fallback marker, not an identified online credential. Production users must configure their own external API token.
- Environment templates and local database Compose: documented placeholders/disposable development values, not private online credentials.

All prescribed strong secret patterns produced zero unexplained matches. No full credential values appear in this report.

## Git History Audit

`git rev-list --count --all` returns **1**. The sole ref is the local main branch and there are no configured remotes. The initial diff contains no binary-diff markers. The full reachable diff was included in secret/keyword review; AWS/GitHub/Google/Slack/SendGrid/Mailgun/private-key/JWT strong patterns found no credentials. Keyword occurrences are expected source code, labels, examples, tests, setup logic, license, and documentation.

`git fsck --full --no-reflogs --unreachable` exits **0** with empty stdout/stderr: no unreachable commits, trees, or blobs remain. There is no imported private repository history. Earlier amend-only object leftovers are resolved. No Git mutation was performed during this audit.

## Packaging Recheck and Resolved Findings

- GPL packaging is now present: LICENSE contains the GNU GPL version 3 text including sections 0–17 and the application instructions; README and contributor/third-party notices specify project-owned code as GPL-3.0-only. The generic “or any later version” example inside the unmodified license's application instructions is not the project's license selector.
- Public onboarding, environment reference, setup, contribution/security guidance, Issue templates, and third-party scope notices are present and were scanned as ordinary text.
- The 24 optional configuration omissions are resolved through the linked environment reference.
- Authentication health-check, UI label, and regression coverage now align with `AUTH_SECRET`.
- The prior unreachable Git amendment objects have been removed and absence independently confirmed.
- The previous missing-license, missing-configuration, authentication-mismatch, and unreachable-object warnings are closed; they are not current findings.

## Audit Method and Limits

The secret scan covered generic API assignments, AWS credentials, credential-bearing database URLs, JWTs, private keys, GitHub tokens, Google OAuth, Slack webhooks, SendGrid/Mailgun, and the anchored entropy heuristic. Additional broad password/secret/token, phone/identity, environment reference, hidden-directory, symlink, and dangerous-file scans supplemented them. PII/internal checks included personal mailbox providers, private IPv4/SSH strings, personal home paths across operating systems, and secret-directory references. Matches were inspected in context; no source file was omitted because of its extension or minification.

The audit did not validate credentials remotely, infer private data from fictitious fixtures, fetch dependencies, or make changes outside this report. Pattern checks cannot prove the absence of every possible encoded payload, vulnerability, or rights issue. Third-party references in documentation were reviewed for disclosure/privacy content; this is not a fresh legal or upstream dependency audit.

## Recommendation

The final source candidate passes all seven sanitization categories and is ready for the authorized repository-creation step, with the three explicitly recorded scope/production/acceptance warnings. No unreadable-file manual-review gate is pending. Preserve the disclosed limitations and complete the remaining dependency/rights and real deployment acceptance work before making stronger production-readiness claims.

## Publication metadata recheck

The repository owner authorized GPL-3.0 and the new repository name fmkj-smart-design. After the public empty repository was created, README and Issue-tracker references were updated to the verified repository URL. The root agent repeated all seven sanitization categories on the resulting 572 text files, including the complete prescribed content-based Step 7. Critical matches: 0; dangerous files: 0; unreadable count: 0; no unreadable sidecar. Environment documentation and the exact GPL text hash were rechecked, and the candidate retained one parentless history with no unreachable objects. Only this report is finalized after that scan; no application source changed. Remote setup and publication follow these checks.
