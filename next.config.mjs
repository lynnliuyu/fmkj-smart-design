/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep middleware's request clone aligned with the point-map API's 32 MiB limit.
  // Multi-floor designs include both engineering and calibrated style backgrounds.
  experimental: {
    proxyClientMaxBodySize: "32mb",
  },
}

export default nextConfig
