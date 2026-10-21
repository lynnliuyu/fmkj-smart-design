import { configDefaults, defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // Standalone builds may contain copied test files; run each source test once.
    // .local is the ignored scratch area (third-party tools with their own runners,
    // e.g. bun:test), not project source.
    exclude: [...configDefaults.exclude, "**/.next/**", "**/.local/**"],
    // The migration and point map suites replay whole SQL pipelines in memory.
    // They take under 1s in isolation but exceed the 5s default when the full
    // suite runs them in parallel, which made the build flake.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
