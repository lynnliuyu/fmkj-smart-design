# Scripts

Routine scripts:

- `doctor.mjs`: local workspace health check. Run with `pnpm doctor` before AI tasks.
- `check-neon.mjs`: verifies the configured Neon/Postgres schema and key table counts.
- `run-migration.mjs`: applies SQL migration files when a plan requires database changes.
- `seed-admin.mjs`: creates or updates a local/admin user from explicit input.

Maintenance scripts have been archived. The one-off catalogue import, image download,
cleanup and rebuild scripts now live in `scripts/archive/` with a README that groups
them by purpose and lists the ones whose hard-coded Windows paths no longer run. They
are kept for provenance only; nothing in `app/`, `components/`, `lib/` or `tests/`
references them.

Still live here:

- `generate-point-icons.mjs`: regenerates `public/assets/point-icons/v1` (run with `pnpm icons:build`).
- `import-product-safety.mjs`: shared guards imported by `tests/product-migration-safety.test.ts`.
- `db-smoke-test.mjs`, `export-cad-review.mjs`, `prepare-cad-*.mjs`, `cadcraft-point-map.mjs`.
- `cad-export-api.mjs`: authenticated asynchronous CAD export API (`pnpm run cad:api`); setup and request contract in `docs/cad-export-api.md`.
- `start-cad-export-web.mjs`: starts the local CAD upload/export test page (`pnpm run cad:web`, http://127.0.0.1:4318/) with installed dependencies and a private browser session. XCLIP rendering requires ezdxf 1.4.5 (pinned in `cadcraft/render-requirements.txt`); see `docs/reports/2026-10-21-cad-hatch-performance-fix.md` for the real DWG benchmark.
- `cadcraft/test-hatch-transforms.py`, `cadcraft/test-clipped-review.py`, `cadcraft/test-pdf-backend.py`: optional offline Python regressions for INSERT hatch spacing / phase, source viewport / XCLIP, and buffered PDF equivalence. Run with the Python environment holding the pinned render dependencies.
- `audit-product-images.mjs`: reports which product images are referenced, including by stored
  quote and delivery snapshots (`pnpm products:audit`).
- `prune-unused-product-images.mjs`: moves unreferenced images out of `public/` into
  `.local/unused-product-images/` and writes a manifest (`pnpm products:prune`, add `--apply` to move).
- `optimize-product-images.mjs`: resizes oversized product images in place without changing paths
  (`pnpm products:optimize` for a dry run, add `--apply` to write).
- `lib/product-image-usage.mjs`: the shared read-only analysis behind audit and prune.
- `architecture-graph.mjs`: reads the editable architecture flowchart (总关系图 + 11 分图) for an Agent —
  summary, `--json` (optionally `--page`), `--find`, `--diff` against a pre-save backup, `--project`
  for another data folder (`pnpm arch:read`). Page titles, stage labels, legends and bare text are
  flagged `decorative` and excluded from business nodes; if the registry is older than the `.drawio`,
  it reads the `.drawio` and says so on stderr.
- `build-architecture-overview.py`: rebuilds the first page (总关系图) from the other pages — main
  business line, support line and guard line, each box carrying `moduleId` / `status` / `code` /
  `notes` (`pnpm arch:overview`). It replaces only that page, backs up the old file first, and is
  idempotent. Contract and data layout in `docs/architecture-agent-collaboration.md`.
- `architecture-editor-server.py`: local/Docker draw.io editor over a data folder of projects
  (`docker/architecture-editor/`, docs/architecture-editor-docker.md). Reads and writes only its
  data directory; saving goes through one-time page tokens and same-origin checks.
- `architecture-editor.py`: the earlier single-file editor for `docs/architecture/system-map.drawio`
  on http://127.0.0.1:8767/. Superseded by the server above for multi-project use, kept working.

SQL setup files:

- `neon-init.sql`: bootstrap schema and seed data for a fresh Neon/Postgres database.
- `create-*.sql`: targeted migrations or support tables for existing databases.
