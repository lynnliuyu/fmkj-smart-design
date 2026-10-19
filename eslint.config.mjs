import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".local/**",
      "tmp/**",
      "output/**",
      "backups/**",
      "public/**",
      "scripts/legacy/**",
    ],
  },
]

export default eslintConfig
