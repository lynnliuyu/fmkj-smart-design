/** Project-root folders used for local work; none are application runtime assets. */
export const PRIVATE_BUILD_DIRECTORIES = [
  "output", ".local", "tmp", "dist", "backups", "docs/architecture-data",
  ".sync-export", ".sync-batches", ".sync-bodies", ".agents/worktrees",
  ".workbuddy", ".dsh", ".git", "build", "out", "coverage",
]

export const PRIVATE_BUILD_FILES = ["config/mcporter.json", ".sync-token.tmp"]

// Keep these rooted: **/dist would also delete required dependency files.
export const PRIVATE_BUILD_TRACE_EXCLUDES = [
  ...PRIVATE_BUILD_DIRECTORIES.map((directory) => `./${directory}/**/*`),
  ...PRIVATE_BUILD_FILES.map((file) => `./${file}`),
  "./.env*",
]

export function isPrivateBuildPath(relativePath) {
  const pathname = relativePath.replaceAll("\\", "/").replace(/^\.\//, "")
  return PRIVATE_BUILD_DIRECTORIES.some((directory) => pathname === directory || pathname.startsWith(`${directory}/`)) ||
    PRIVATE_BUILD_FILES.includes(pathname) || /^\.env[^/]*$/.test(pathname)
}
