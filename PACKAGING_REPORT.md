# Open-source Packaging Report

> 历史记录：本报告记录首次 GPL-3.0 发布时的状态。项目所有者随后于 2026-10-19 将项目自有代码改为 MIT；当前许可见根目录 LICENSE。第三方许可保持各自声明。

Date: 2026-10-19 (Asia/Shanghai)
Status: local publication candidate packaged; final sanitization and publication checks remain required.
Target: `lynnliuyu/fmkj-smart-design`. This report does not establish that the remote repository exists or is public.

## Files

| File | Lines | Action |
| --- | ---: | --- |
| `LICENSE` | 232 | 新建 |
| `CLAUDE.md` | 66 | 新建 |
| `setup.sh` | 42 | 新建 |
| `CONTRIBUTING.md` | 29 | 新建 |
| `SECURITY.md` | 16 | 新建 |
| `THIRD_PARTY_NOTICES.md` | 26 | 新建 |
| `docs/environment.md` | 62 | 新建 |
| `.github/ISSUE_TEMPLATE/bug_report.md` | 31 | 新建 |
| `.github/ISSUE_TEMPLATE/feature_request.md` | 25 | 新建 |
| `README.md` | 102 | 增强 / 更新 |
| `package.json` | 82 | 增强 / 更新 |
| `.env.example` | 12 | 增强 / 更新 |
| `AGENTS.md` | 25 | 增强 / 更新 |
| `docs/agents/issue-tracker.md` | 27 | 增强 / 更新 |

README retains links to domain context, core workflows, ADR-related Plan 021 and the documentation index. It explains the empty initial product catalogue, excluded customer data/media, separate database setup, development versus production modes, optional external tools and current limitations. CLAUDE.md stays below 100 lines. Existing fork and sanitization reports remain intact as historical stage reports.

## License and third-party scope

- Package name is `fmkj-smart-design`; project license is `GPL-3.0-only`. Existing dependency versions and scripts are unchanged.
- LICENSE is the complete `licenseText` from SPDX's official `https://spdx.org/licenses/GPL-3.0-only.json`, retaining the Free Software Foundation license-document notice. Project copyright is `Copyright (c) 2026 Contributors` in README and THIRD_PARTY_NOTICES.
- LICENSE SHA-256: `fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0`.
- Read-only package metadata inspection confirmed `@mlightcad/libredwg-web@0.8.0` declares `GPL-3.0` and `@vercel/analytics@1.3.1` declares `MPL-2.0`. The latter includes a package LICENSE. The CAD package's precise upstream licensing scope still needs review; project licensing does not relicense it.
- No complete direct/transitive dependency or asset-rights audit is claimed. Optional CLI tools, fonts, third-party material and trademarks retain their own terms.

## Verified by this packaging stage

- Read actual package scripts, Docker configuration, database migration and seed implementations, diagnostic script, environment reads and optional CAD/PDF documentation.
- README / CLAUDE / contribution / setup `pnpm run` commands all resolve to scripts in package.json.
- `bash -n setup.sh` passed; script is executable (0755).
- `git diff --check` passed when packaging completed.
- setup checks Node.js >=22 and pnpm major 12, performs `pnpm install --frozen-lockfile`, preserves existing `.env.local`, and exclusively creates new local configuration with mode 0600 and a random AUTH_SECRET without printing it. It does not start services or run database operations. Runtime behavior is to be independently verified by the root agent.
- Environment documentation covers every variable enumerated by SANITIZATION_REPORT. The report calls them 25 but its list contains 24 (5 product/API, 7 administrator/tooling, 12 database/Compose); AUTH_INITIAL_ADMIN is additionally documented. No invented credential or unused variable was introduced to fill the count.

## Not verified by this packaging stage

No dependency installation, test suite, build, service, database migration/seed, Docker clean-database acceptance or real business browser/PDF workflow was run by Packager. Separate validation evidence belongs in the final delivery report. setup installation and no-overwrite behavior still require the independent script check.

Known limitations remain visible in README/SECURITY: public Blob URLs are unsuitable for confidential attachments; SMS/email providers are not production-integrated; real browser business and fresh Docker database acceptance are incomplete. Passing source sanitization or automated checks does not establish customer delivery completion.

No commits, Git-history cleanup, source-repository mutation, remote configuration, GitHub write or publication was performed. The final source snapshot must undergo the prescribed sanitizer checks after all agents' changes and candidate Git-object cleanup.
