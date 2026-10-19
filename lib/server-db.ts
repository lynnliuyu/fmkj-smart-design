import { Pool } from "pg"

let pool: Pool | null = null

export function hasDatabaseUrl() {
  return Boolean(databaseConnectionString() || databaseConnectionConfig())
}

export function getPool() {
  if (!hasDatabaseUrl()) {
    throw new Error("Database environment variables are not set")
  }

  if (!pool) {
    const connectionString = databaseConnectionString()
    pool = new Pool({
      ...(connectionString
        ? { connectionString }
        : databaseConnectionConfig()),
      ssl: shouldUseSsl() ? { rejectUnauthorized: false } : false,
    })
  }

  return pool
}

function databaseConnectionString() {
  return envValue("DATABASE_URL") || envValue("POSTGRES_URL") || envValue("POSTGRES_PRISMA_URL")
}

function databaseConnectionConfig() {
  const host = envValue("PGHOST") || envValue("POSTGRES_HOST")
  const user = envValue("PGUSER") || envValue("POSTGRES_USER")
  const password = envValue("PGPASSWORD") || envValue("POSTGRES_PASSWORD")
  const database = envValue("PGDATABASE") || envValue("POSTGRES_DATABASE")

  if (!host || !user || !password || !database) {
    return null
  }

  return {
    database,
    host,
    password,
    user,
  }
}

function shouldUseSsl() {
  return process.env.DATABASE_SSL === "true" || Boolean(envValue("PGHOST") || envValue("POSTGRES_HOST"))
}

function envValue(key: string) {
  const value = process.env[key]?.trim()
  if (!value || value === "\"\"" || value === "''") {
    return ""
  }
  return value.replace(/^["']|["']$/g, "")
}

