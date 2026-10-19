# 环境变量

真实凭据放 `.env.local` 或部署平台，禁止提交。`.env.example` 是通用模板，`.env.local.example` 使用本机一次性 Docker 数据库，`.env.production.example` 仅提供待填写的生产配置。

Next.js 本机会加载 `.env.local`；迁移与管理员脚本也读取此文件，但不会覆盖已导出的进程变量。Docker 应用 Compose 从 `.env.production` 注入环境。数据库 Compose 的 `${...}` 插值读取 shell / Compose `.env`（不会自动读取 `.env.local`）。不要把应用环境文件当作通用 shell 脚本执行。

## 主要配置

| 变量 | 必需性 / 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 数据库功能需要；迁移和 seed 必需 | PostgreSQL URL；本机示例仅用于开发，生产自行配置 |
| `DATABASE_SSL` | 建议明确设置 | 应用连接串模式仅 `true` 启用 SSL；应用分字段连接还会因主机变量启用 SSL。迁移脚本除 `false` 外均启用，seed 仅 `true` 启用；为避免脚本差异，始终明确填写 |
| `PRODUCTS_TABLE` | 可选；`products` | 产品读取表名 |
| `AUTH_SECRET` | 生产必需 | 会话签名密钥；setup 本机随机生成，不打印；开发回退常量不能用作生产密钥 |
| `AUTH_DEV_MODE` | 可选；不启用 | 本机模板为 `true`，生产必须 `false`；仅作为开发流程配置 |
| `BLOB_READ_WRITE_TOKEN` | 云附件上传时必需 | 自行申请 Blob 凭据；当前上传生成公开 URL，不适合保密附件 |
| `AUTH_INITIAL_ADMIN` | 可选；不指定 | 验证码登录成功后匹配此身份会设置用户 role 为 admin；不替代 seed 的完整超级管理员档案与密码 |

## 产品接口与导入（5 项可选配置）

| 变量 | 默认 / 优先级 | 说明 |
| --- | --- | --- |
| `PRODUCTS_LIMIT` | `2000` | 产品数据库读取条数 |
| `FMKJ_API_BASE_URL` | 优先于下一项 | 备用 HTTP 产品接口地址 |
| `NEXT_PUBLIC_API_BASE_URL` | 再回退到 `http://127.0.0.1:4000` | 产品接口替代地址；`NEXT_PUBLIC_` 配置可进入客户端构建，不得存秘密 |
| `FMKJ_API_TOKEN` | 优先于下一项 | 备用 HTTP 产品接口的 Bearer token |
| `DEV_AUTH_TOKEN` | 再回退到显式本地开发标记 | 旧开发接口 token 替代项；默认开发标记不能用作生产访问凭据 |

## 管理员与工具（7 项可选配置）

| 变量 | 默认 / 必需条件 | 说明 |
| --- | --- | --- |
| `SEED_ADMIN_EMAIL` | `admin@example.com`；可由 `--email` 覆盖 | 创建或更新的管理员邮箱；应填写自己的身份 |
| `SEED_ADMIN_PASSWORD` | 无；执行 seed 时必填（或 `--password`） | seed 会更新已有同邮箱账号的密码和管理员权限；完成后移除引导密码 |
| `CADCRAFT_CLI` | PATH 中 `cadcraft-cli` | 单独安装的 CADCraft CLI 路径；可选 CAD 工作流需要 Node.js 24+ |
| `CAD_REVIEW_PYTHON` | 部分脚本尝试已有工作站 Python 运行时 | CAD PDF 参考图辅助脚本的 Python；跨平台请明确指定含 pypdf 的解释器 |
| `PDFTOPPM` | PATH 中 `pdftoppm` | Poppler PDF 栅格化工具路径；可选 CAD/PDF 流程需要单独安装 |
| `EXPECTED_GITHUB_REPO` | 空：不强制远端匹配 | `pnpm run doctor` 可选的预期 GitHub 仓库名；fork 时改为自身仓库 |
| `NEXT_PUBLIC_APP_VERSION` | 托管平台提交短哈希，否则 `local` | 管理后台展示版本；属于公开构建信息 |

## 数据库替代连接与 Compose（12 项可选配置）

应用连接串优先级为 `DATABASE_URL` → `POSTGRES_URL` → `POSTGRES_PRISMA_URL`，都未设置时才使用分字段配置。分字段必须同时有主机、用户、密码和数据库名；各组按表内顺序取第一个非空值。

| 变量 | 默认 / 用途 | 说明 |
| --- | --- | --- |
| `POSTGRES_URL` | 无；应用 URL 第 2 优先级 | 不替代迁移与 seed 要求的 `DATABASE_URL` |
| `POSTGRES_PRISMA_URL` | 无；应用 URL 第 3 优先级 | 同上 |
| `PGHOST` | 无；主机第 1 优先级 | 应用分字段连接 |
| `POSTGRES_HOST` | 无；主机第 2 优先级 | 应用分字段连接 |
| `PGUSER` | 无；用户第 1 优先级 | 应用分字段连接 |
| `POSTGRES_USER` | 应用无默认；数据库 Compose 默认 `postgres` | 应用分字段连接及开发容器账号 |
| `PGPASSWORD` | 无；密码第 1 优先级 | 应用分字段连接；不得提交真实值 |
| `POSTGRES_PASSWORD` | 应用无默认；数据库 Compose 默认一次性开发值 | 应用分字段连接及开发容器密码；生产必须独立配置 |
| `PGDATABASE` | 无；数据库名第 1 优先级 | 应用分字段连接 |
| `POSTGRES_DATABASE` | 无；数据库名第 2 优先级 | 应用分字段连接 |
| `POSTGRES_DB` | 数据库 Compose 默认 `fmkj` | 创建开发容器数据库；不是应用分字段连接变量 |
| `POSTGRES_PORT` | 数据库 Compose 默认 `15432` | 发布在主机 `127.0.0.1` 的端口；自定义时同步修改 `DATABASE_URL` |

应用分字段未提供显式端口配置；自定义端口请使用连接串。审计报告称缺失 25 项，其逐项清单实际列出 24 项；本文已覆盖全部列举项，并另列 `AUTH_INITIAL_ADMIN`，不补造无用变量。

`NODE_ENV` 由 Next.js / 部署设置；`VERCEL`、`VERCEL_GIT_COMMIT_SHA` 由平台注入；`PYTHONPATH` 为 Python 自身配置。无需为这些值制造模板凭据。CADCraft、PDFCraft 与字体的安装、路径和授权见 README 及相关工具文档。
