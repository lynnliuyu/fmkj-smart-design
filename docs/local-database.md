# 本地 Docker 数据库

本项目用 `pg` 直连 PostgreSQL，生产环境跑在 Neon。本文件说明如何在本机用 Docker 起一套等价数据库用于开发。

## 组成

| 项 | 值 |
| --- | --- |
| 容器名 | `fmkj-v3-db` |
| 镜像 | `postgres:17-alpine` |
| 宿主机端口 | `15432`（避开本机已在用的 5432 / 15444） |
| 容器内端口 | `5432` |
| 数据库 | `fmkj` |
| 用户 / 密码 | `postgres` / `postgres` |
| 数据卷 | `fmkj-v3-db-data` |

Compose 文件是 `docker-compose.db.yml`，与生产的 `docker-compose.yml` 分开，避免本地数据库配置混进生产编排。

## 常用命令

```bash
pnpm db:up       # 启动容器
pnpm db:down     # 停止容器（保留数据卷）
pnpm db:reset    # 销毁容器和数据卷（数据全部丢失）
pnpm db:migrate  # 建表 / 增量迁移
pnpm db:check    # 结构自检
pnpm db:smoke    # 连通性 + 写读冒烟测试
```

迁移脚本全部幂等（`IF NOT EXISTS`），重复执行 `pnpm db:migrate` 安全。

## 首次初始化顺序

```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed-admin --email=you@example.com --password='你的密码'
pnpm db:smoke
```

`pnpm dev` 之后访问 `/login` 用刚建的账号登录。

## 连接串

`.env.local`（已被 `.gitignore` 忽略）：

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:15432/fmkj
DATABASE_SSL=false
PRODUCTS_TABLE=products
```

`DATABASE_SSL` 必须是 `false`：本地容器没有开 SSL，代码里 `shouldUseSsl()` 读的就是这个变量，写成 `true` 会导致连接失败。

`AUTH_SECRET` 用 `openssl rand -base64 32` 生成。

## 数据库连接工具

容器内直接用 `psql`：

```bash
docker exec -it -e PGPASSWORD=postgres fmkj-v3-db psql -U postgres -d fmkj
```

宿主机 GUI 工具（TablePlus、DBeaver、DataGrip）填 `127.0.0.1:15432`，用户 `postgres`，密码 `postgres`，库 `fmkj`。

## 迁移链说明

`scripts/run-migration.mjs` 按固定顺序执行这些文件：

1. `neon-init.sql` — 核心业务表（products / projects / quotes / work_orders 等）
2. `create-auth-tables.sql` — users / verification_codes
3. `create-roles-table.sql` — roles 平台角色表 + `users.role_id`
4. `create-activity-log-table.sql`
5. `create-account-commerce-tables.sql` — 账号档案、套餐、订阅、订单、企业组织
6. `create-project-workbench-fields.sql`
7. `create-project-options.sql`
8. `create-product-moderation-status-values.sql`
9. `create-product-moderation-fields.sql`
10. `create-platform-health-support.sql`
11. `create-performance-indexes.sql`
12. `normalize-product-categories.sql`
13. `create-project-site-photos.sql`
14. `create-work-orders.sql`
15. `normalize-product-platform-brand.sql`

其中 `create-roles-table.sql` 是后补的：`app/api/auth/register`、`app/api/auth/login`、`lib/account-team-service.ts` 都依赖 `roles` 表和 `users.role_id`，但早期迁移链没有创建它们（生产 Neon 库里是手工建的），在全新数据库上会直接报错。

## 已知限制

- `BLOB_READ_WRITE_TOKEN` 未配置，产品图上传、报价 PDF、合同、户型图等文件存储相关功能不可用。其余业务功能正常。
- Docker 里的数据随数据卷存在本机，不会同步到生产 Neon。两套环境数据独立。
