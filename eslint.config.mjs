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
      // 第三方预编译产物（libredwg-web 的 dist/wasm 与 cadcraft 的 tar 包），不是本仓库的代码。
      "docker/cad-export/vendor/**",
    ],
  },
]

export default eslintConfig
