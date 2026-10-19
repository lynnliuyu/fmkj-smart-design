# FMKJ V3

Version 0.0.1 · Port 3000 · Next.js 16 / React 19 / TypeScript / PostgreSQL

智能家居项目管理、点位设计、报价与固定版本客户交付系统。
初始产品库为空；客户数据、商品照片、历史交付与实际凭据不随源码提供。

## 开始工作

先读 AGENTS.md、CONTEXT.md 与相关 docs/adr/。
点位/报价变更再读 ADR 0005—0007、plans/021-workbench-workflow-consolidation.md。
产品采集按 docs/product-catalog-agent-guide.md，禁止猜测 SKU、价格和安装条件。

## 启动

需要 Node.js 22+、pnpm 12；本地数据库示例需 Docker Compose v2。

```bash
./setup.sh
pnpm run db:up
# 等待数据库健康；按需编辑 .env.local 的数据库配置。
pnpm run db:migrate
# 在 .env.local 设置 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD。
pnpm run db:seed-admin
# 创建后移除 SEED_ADMIN_PASSWORD。
pnpm run dev
```

setup 不覆盖已有 .env.local，不启动服务、不修改数据库。
生产运行：配置数据库、完成迁移后执行 pnpm run build 和 pnpm run start。
Docker 构建、迁移、seed、启动顺序见 README.md，不能省略数据库准备。

## 验证命令

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run doctor
```

项目 doctor 是 scripts/doctor.mjs；pnpm doctor 是包管理器自带命令。
测试通过不能证明客户方案已保存、固定版本已生成或实际导出正确。

## 架构

- app/：Next.js 页面与服务端 API
- components/：工作台、产品、点位图与 UI
- lib/：领域规则、数据库、认证、报价与交付服务
- scripts/：迁移、管理员引导、产品维护、可选 CAD/PDF 工具
- public/assets/point-icons/：共享几何生成的中性 SVG 点位符号
- docs/：操作、ADR 与领域文档；plans/：计划与实施记录

复用现有预览、报价和交付服务，不另建客户端采购计算或导出数据源。
项目换型不改全局默认；删除来源报价行联动删除点位与场景引用。
默认型号可作明确标识的未核验客户报价。客户文件使用固定交付版本。

## 配置与边界

配置见 .env.example 和 docs/environment.md，真实凭据只能存本地或部署环境。
AUTH_SECRET 用于会话签名；生产必须独立生成，禁用 AUTH_DEV_MODE。
公开 Blob URL 不适合保密附件。短信与邮件尚未接入生产。
可选 CAD/PDF CLI、Poppler、Python 库和中文字体需单独安装并确认授权。
GPL-3.0-only 适用于项目自有代码；保留第三方原有许可与声明。
贡献见 CONTRIBUTING.md，漏洞见 SECURITY.md。
