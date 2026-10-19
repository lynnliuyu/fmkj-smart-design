import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

loadLocalEnv();

const requiredTables = [
  "products",
  "projects",
  "quotes",
  "quote_items",
  "activity_logs",
  "account_profiles",
  "plans",
  "subscriptions",
];
const requiredProductColumns = [
  "submitted_by",
  "reviewed_by",
  "reviewed_at",
  "review_note",
];
const requiredProjectColumns = [
  "next_action_owner_name",
  "owner_type",
  "owner_id",
  "risk_reason",
  "waiting_on",
];
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is missing. Run `vercel env pull .env.local --yes` or fill .env.local.",
  );
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

try {
  const client = await pool.connect();
  try {
    const version = await client.query(
      "select current_database() as database, current_user as user",
    );
    console.log(`Connected to database: ${version.rows[0].database}`);
    console.log(`Connected as user: ${version.rows[0].user}`);

    const tables = await client.query(
      `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name
      `,
      [requiredTables],
    );

    const existingTables = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter(
      (table) => !existingTables.has(table),
    );

    if (missingTables.length > 0) {
      console.error(`Missing tables: ${missingTables.join(", ")}`);
      console.error("Run scripts/neon-init.sql in Neon SQL Editor first.");
      process.exitCode = 1;
    } else {
      const productCount = await client.query(
        "select count(*)::int as count from products where deleted_at is null",
      );
      const projectCount = await client.query(
        "select count(*)::int as count from projects where deleted_at is null",
      );
      const productColumns = await client.query(
        `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'products'
          and column_name = any($1::text[])
        `,
        [requiredProductColumns],
      );
      const projectColumns = await client.query(
        `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'projects'
          and column_name = any($1::text[])
        `,
        [requiredProjectColumns],
      );
      const existingProductColumns = new Set(
        productColumns.rows.map((row) => row.column_name),
      );
      const existingProjectColumns = new Set(
        projectColumns.rows.map((row) => row.column_name),
      );
      const missingProductColumns = requiredProductColumns.filter(
        (column) => !existingProductColumns.has(column),
      );
      const missingProjectColumns = requiredProjectColumns.filter(
        (column) => !existingProjectColumns.has(column),
      );

      console.log(`Products: ${productCount.rows[0].count}`);
      console.log(`Projects: ${projectCount.rows[0].count}`);
      if (missingProductColumns.length > 0) {
        console.error(
          `Missing product moderation columns: ${missingProductColumns.join(", ")}`,
        );
        process.exitCode = 1;
      } else if (missingProjectColumns.length > 0) {
        console.error(
          `Missing project workflow columns: ${missingProjectColumns.join(", ")}`,
        );
        process.exitCode = 1;
      } else {
        console.log("Neon schema check passed.");
      }
    }
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

function loadLocalEnv() {
  const envPath = resolve(".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
