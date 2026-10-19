# 繁梦空间设计站 · FMKJ V3

面向智能家居设计的项目管理、点位设计、产品选型、报价与固定版本交付系统。技术栈为 Next.js 16、React 19、TypeScript、PostgreSQL 和 Vitest。

源码仓库：[lynnliuyu/fmkj-smart-design](https://github.com/lynnliuyu/fmkj-smart-design)。

此版本提供应用源码、数据库迁移和中性 SVG 符号；**产品库初始为空，不附带客户资料、真实产品图片、渠道价格或历史交付文件**。请自行准备有权使用的商品资料与图片，按[产品采集指南](docs/product-catalog-agent-guide.md)入库。数据库迁移会建立基础角色与套餐等系统数据；管理员需另行创建。

## 本机开始

需要 Node.js 22+、pnpm 12，以及 PostgreSQL。以下本地数据库方式另需 Docker Engine / Docker Desktop 与 Compose v2。可选 CAD 工作流需要 Node.js 24+，详见下文。

克隆源码并准备本机环境：

```bash
git clone https://github.com/lynnliuyu/fmkj-smart-design.git
cd fmkj-smart-design
./setup.sh
pnpm run db:up
# 等数据库健康后继续；查看状态：docker compose -f docker-compose.db.yml ps
pnpm run db:migrate
```

`setup.sh` 安装锁文件中的依赖；首次从 `.env.local.example` 创建权限为 600 的 `.env.local`，自动生成随机 `AUTH_SECRET`，不会打印密钥或覆盖已有配置，也不会启动服务或连接数据库。示例连接串只用于本机一次性开发库；使用现有 PostgreSQL 时，先修改 `.env.local`，并省略 `db:up`。

在 `.env.local` 中填写自己的 `SEED_ADMIN_EMAIL` 与 `SEED_ADMIN_PASSWORD`，再执行：

```bash
pnpm run db:seed-admin
pnpm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 登录。创建完成后从环境文件移除引导密码。此命令会创建或更新指定邮箱的超级管理员并重置其密码，不要对现有业务库随意执行。数据库初始化与维护见[本地数据库说明](docs/local-database.md)。`db:reset` 会删除开发库数据卷。

## 配置与日常运行

主要配置为 `DATABASE_URL`、`DATABASE_SSL`、`AUTH_SECRET`；云附件上传另需自己的 `BLOB_READ_WRITE_TOKEN`。配置模板见 [.env.example](.env.example)，完整的可选项、数据库替代连接配置与优先级见[环境变量说明](docs/environment.md)。生产环境应设置 `AUTH_DEV_MODE=false` 并使用独立数据库和随机密钥。

开发时使用 `pnpm run dev`，包含编译与热更新；日常使用可先停止开发服务，再运行生产模式，以减少开发工具开销：

```bash
pnpm run build
pnpm run start
```

两种方式默认占用同一个 3000 端口。生产模式也需要已配置、已迁移的数据库。

| 命令 | 用途 |
| --- | --- |
| `pnpm run typecheck` | TypeScript 检查 |
| `pnpm run test` | Vitest 单元与集成测试 |
| `pnpm run lint` | ESLint 检查 |
| `pnpm run doctor` | 调用 `scripts/doctor.mjs`，检查仓库、配置存在性与 3000 端口；不验证真实业务操作 |
| `pnpm run db:check` | 数据库结构检查 |
| `pnpm run db:smoke` | 数据库写读冒烟检查，会连接配置的数据库 |
| `pnpm run db:down` | 停止本地数据库，保留数据卷 |
| `pnpm run icons:build` | 从共享几何定义生成点位 SVG |

请用 `pnpm run doctor` 明确调用项目脚本；`pnpm doctor` 是 pnpm 自带的环境检查。

## Docker 应用部署

应用 Compose 不包含数据库。先准备应用容器可访问的独立 PostgreSQL，再复制 `.env.production.example` 为 `.env.production`，填入真实连接串、随机 `AUTH_SECRET` 与所需配置。容器中的 `127.0.0.1` 指容器自身。`.env.production` 不应提交 Git。

按构建、迁移、创建管理员、启动的顺序操作：

```bash
cp .env.production.example .env.production
# 编辑 .env.production，填写数据库、密钥、SEED_ADMIN_EMAIL 和 SEED_ADMIN_PASSWORD
docker compose build app
docker compose run --rm --no-deps app node scripts/run-migration.mjs
docker compose run --rm --no-deps app node scripts/seed-admin.mjs
# 从 .env.production 移除 SEED_ADMIN_PASSWORD，再启动
docker compose up -d app
```

备份、TLS、存储权限及运维监控由部署者配置。当前版本尚未完成 Docker 新库端到端验收。

## 业务规则与扩展工具

日常流程为“点位设计 → 报价单 → 客户交付”。默认型号允许作明确标识的未核验客户报价，项目换型只影响本项目；删除来源报价行会联动删除安装点与场景引用。客户出口使用固定交付版本，草稿检查图不属于历史整套方案。

业务背景与词汇见 [CONTEXT.md](CONTEXT.md)，核心流程见[业务流程](docs/core-business-flow.md)，操作见[点位设计](docs/point-map-design-workflow.md)、[视觉交付](docs/point-map-visual-presentation-workflow.md)和 [Plan 021](plans/021-workbench-workflow-consolidation.md)；更多资料见[文档索引](docs/README.md)。

可选 CAD 与 PDF 工具不会随本仓库安装：CADCraft / PDFCraft CLI 需另行取得并确认使用授权；CAD 导出还需要 Poppler，部分 PDF 工具需要 Python、pypdf / ReportLab 与允许嵌入的中文字体。跨平台使用需自行配置工具路径和字体，不能假设存在特定工作站运行时。详见 [CAD 桥接](docs/cadcraft-point-map-bridge.md)与 [PDF 模板说明](docs/templates/pdf/README.md)。PDF 模板样稿不代表正式客户交付已接通或验收。

## 当前限制

- 附件上传使用公开 Blob URL，持有 URL 的人可直接访问文件；当前方案不适合保密合同或客户附件，应先改造存储访问控制。
- 短信、邮件供应商尚未接入生产，相关界面不代表真实通知可达。
- 自动化测试与构建不替代真实业务浏览器验收、数据库持久化确认、固定版本和实际客户文件导出核验；这些完整验收尚未完成。
- 脱敏、封装与验证报告记录首次开源版本的检查范围，不代表完整安全认证或第三方权利审计。

## 贡献与 AI 协作

使用 Claude Code 时，先阅读 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)；其他助手也应遵循相同的领域规则。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，漏洞报告见 [SECURITY.md](SECURITY.md)。Issue 请提交到你当前使用仓库的 Issues；本项目仓库为 `lynnliuyu/fmkj-smart-design`。

## 许可证

Copyright (c) 2026 Contributors。项目自有代码采用 **GPL-3.0-only**，全文见 [LICENSE](LICENSE)。这允许商业使用；传播受 GPL 覆盖的修改版时需遵守相应源码与许可义务，以许可证全文为准。

依赖、第三方工具、字体及品牌商标保留各自权利，不会因本项目的 GPL 自动重新授权。已核对的直接依赖与素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；尚未完成全部传递依赖的许可审计。
