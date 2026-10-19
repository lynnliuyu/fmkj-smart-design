# Scripts

Routine scripts:

- `doctor.mjs`: local workspace health check. Run with `pnpm doctor` before AI tasks.
- `check-neon.mjs`: verifies the configured Neon/Postgres schema and key table counts.
- `run-migration.mjs`: applies SQL migration files when a plan requires database changes.
- `seed-admin.mjs`: creates or updates a local/admin user from explicit input.

One-off catalogue imports, channel pricing, image downloads and rebuild data are excluded from this public candidate.

Still live here:

- `generate-point-icons.mjs`: regenerates `public/assets/point-icons/v1` (run with `pnpm icons:build`).
- `import-product-safety.mjs`: shared guards imported by `tests/product-migration-safety.test.ts`.
- `db-smoke-test.mjs`, `export-cad-review.mjs`, `prepare-cad-*.mjs`, `cadcraft-point-map.mjs`.
- `audit-product-images.mjs`: reports which product images are referenced, including by stored
  quote and delivery snapshots (`pnpm products:audit`).
- `prune-unused-product-images.mjs`: moves unreferenced images out of `public/` into
  `.local/unused-product-images/` and writes a manifest (`pnpm products:prune`, add `--apply` to move).
- `optimize-product-images.mjs`: resizes oversized product images in place without changing paths
  (`pnpm products:optimize` for a dry run, add `--apply` to write).
- `lib/product-image-usage.mjs`: the shared read-only analysis behind audit and prune.

SQL setup files:

- `neon-init.sql`: bootstrap schema and seed data for a fresh Neon/Postgres database.
- `create-*.sql`: targeted migrations or support tables for existing databases.
