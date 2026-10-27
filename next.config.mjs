import { PRIVATE_BUILD_TRACE_EXCLUDES } from "./lib/build-artifact-policy.mjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Dynamic filesystem reads must never carry local customer drawings, backups,
  // credentials or generated installers into the standalone application.
  outputFileTracingExcludes: { "**/*": PRIVATE_BUILD_TRACE_EXCLUDES },
  // Keep middleware's request clone aligned with the point-map API's 32 MiB limit.
  // Multi-floor designs include both engineering and calibrated style backgrounds.
  experimental: {
    proxyClientMaxBodySize: "32mb",
  },
}

export default nextConfig
