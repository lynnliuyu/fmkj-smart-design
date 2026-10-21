import { execFile } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const root = process.cwd()
const expectedRepo = "lynnliuyu/fmkj-smart-design"
const expectedPathSuffix = path.join("Documents", "ChatGPT", "繁梦空间设计站")

const checks = []

function pass(name, detail = "") {
  checks.push({ status: "PASS", name, detail })
}

function warn(name, detail = "") {
  checks.push({ status: "WARN", name, detail })
}

function fail(name, detail = "") {
  checks.push({ status: "FAIL", name, detail })
}

function envValue(value) {
  const normalized = String(value ?? "").trim()
  if (!normalized || normalized === "\"\"" || normalized === "''") return ""
  return normalized.replace(/^["']|["']$/g, "")
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const env = {}
  const text = fs.readFileSync(filePath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env[match[1]] = envValue(match[2])
  }
  return env
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root })
  return stdout.trim()
}

async function checkWorkspace() {
  if (root.endsWith(expectedPathSuffix)) {
    pass("workspace path", root)
  } else {
    warn("workspace path", `Current path is ${root}; expected suffix ${expectedPathSuffix}`)
  }

  if (!fs.existsSync(path.join(root, "package.json"))) {
    fail("package.json", "Missing package.json in current directory")
  } else {
    pass("package.json")
  }
}

async function checkGit() {
  try {
    const branch = await git(["branch", "--show-current"])
    const remotes = await git(["remote", "-v"])

    if (branch === "main") pass("git branch", branch)
    else warn("git branch", branch || "(detached)")

    if (remotes.includes(expectedRepo)) pass("git remote", expectedRepo)
    else warn("git remote", remotes || "(none)")

    const status = await git(["status", "--short"])
    if (status) warn("git worktree", `${status.split(/\r?\n/).length} changed file(s)`)
    else pass("git worktree", "clean")
  } catch (error) {
    fail("git", error.message)
  }
}

async function checkEnv() {
  const envPath = path.join(root, ".env.local")
  if (!fs.existsSync(envPath)) {
    fail(".env.local", "Missing local environment file")
    return
  }

  pass(".env.local", "present")
  const env = parseEnvFile(envPath)

  const hasDatabaseUrl = Boolean(env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL)
  const hasSplitPostgres = Boolean(env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE)

  if (hasDatabaseUrl) {
    pass("database env", "connection string present")
  } else if (hasSplitPostgres) {
    pass("database env", "split PG variables present")
  } else {
    fail(
      "database env",
      "No non-empty DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE values in .env.local",
    )
  }

  if (env.AUTH_SECRET) pass("AUTH_SECRET", "present")
  else warn("AUTH_SECRET", "missing or empty")
}

async function checkPort3000() {
  const isOpen = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 3000 })
    socket.setTimeout(800)
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })
    socket.on("error", () => resolve(false))
  })

  if (!isOpen) {
    warn("port 3000", "not listening")
    return
  }

  pass("port 3000", "listening")
}

async function checkPackageScripts() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  for (const script of ["dev", "typecheck", "test", "doctor"]) {
    if (packageJson.scripts?.[script]) pass(`script:${script}`)
    else warn(`script:${script}`, "missing")
  }
}

async function main() {
  await checkWorkspace()
  await checkGit()
  await checkEnv()
  await checkPort3000()
  await checkPackageScripts()

  const width = Math.max(...checks.map((check) => check.name.length), 10)
  for (const check of checks) {
    const label = check.status.padEnd(4)
    const name = check.name.padEnd(width)
    const detail = check.detail ? `  ${check.detail}` : ""
    console.log(`${label} ${name}${detail}`)
  }

  const failures = checks.filter((check) => check.status === "FAIL")
  const warnings = checks.filter((check) => check.status === "WARN")

  console.log("")
  console.log(`Doctor summary: ${failures.length} failed, ${warnings.length} warning(s), ${checks.length} total.`)

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
