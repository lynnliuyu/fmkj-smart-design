# 繁梦空间设计站

**给做智能家居的人用的一套工具：在户型图上标点位、从产品库选型号、自动生成报价单、把方案交付给客户。**

装在你自己的电脑或服务器上，**客户资料、价格和报价单都在你自己手里**，不上传到别人的服务器。

> 不写代码也能用。下面「三种开始方式」挑一种，照着复制粘贴就行；每一步都写了「你会看到什么」。

---

## 它能帮你做什么

| 你想做的事 | 在这个工具里 |
| --- | --- |
| 在户型图上标出每个开关、窗帘、摄像头装在哪 | 「项目 → 点位图」，把符号拖到户型图上 |
| 知道每个房间要用多少设备 | 点位图会自动数，按类别汇总 |
| 从自己的产品库里挑型号、看参数和价格 | 「产品库」，可按品牌、类别、点位筛选 |
| 给客户出报价单 | 「报价单」，从点位图或产品库拉进来，自动算总价 |
| 把方案交给客户 | 「方案交付」，生成固定版本的方案与报价资料 |
| 记住每个项目的进展 | 「项目」，从勘场到交付一条线 |

一句话：**点位设计 → 报价单 → 客户交付**，中间不用来回换软件。

---

## 三种开始方式，挑一种

### 方式一：你手上是我们刷好的机器（最省事）

1. 机器插网线、通电，等 2 分钟
2. 电脑浏览器打开 `http://机器的IP地址:8890`
3. 按页面提示设置管理员账号（邮箱 + 密码），登录即可

> 不知道机器 IP？看路由器后台的设备列表，或问给你机器的人。
> 完整说明（含备份、更新、排障）在[设备手册](docs/appliance-handbook.html)。

### 方式二：装在自己的电脑或服务器上（Docker）

**你需要**：一台 Windows / Mac / Linux 电脑，装好免费的 [Docker Desktop](https://www.docker.com/products/docker-desktop/)；
建议 4GB 以上内存、20GB 空闲硬盘。

打开终端（Windows 用 PowerShell），**逐条**复制粘贴：

```bash
# 1) 下载项目
git clone https://github.com/lynnliuyu/fmkj-smart-design.git
cd fmkj-smart-design

# 2) 启动数据库（第一次会下载，约 1 分钟）
docker compose -f docker-compose.db.yml up -d
#    看到 "Started" 就成了；数据库端口是 15432

# 3) 准备配置文件：复制模板，然后按下面说明改 3 处
cp .env.production.example .env.production
```

用记事本打开 `.env.production`，改这 3 处：

```
DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:15432/fmkj
AUTH_SECRET=（随便打一串 32 位以上的随机字符，别告诉别人）
SEED_ADMIN_EMAIL=你的邮箱
SEED_ADMIN_PASSWORD=你想设的管理员密码（8 位以上）
```

```bash
# 4) 建表、建管理员（第一次必须做）
docker compose build app
docker compose run --rm --no-deps app node scripts/run-migration.mjs
docker compose run --rm --no-deps app node scripts/seed-admin.mjs

# 5) 启动
docker compose up -d app
```

浏览器打开 **http://localhost:3000**，用第 3 步填的邮箱和密码登录。
（能打开登录页就说明成功了；打不开看下面的「常见问题」。）

> ⚠️ 这个方式没有把上传的图片单独存到外面，**重建容器前请先备份**（见下面「日常维护」）。
> 我们还没有在全新数据库上完整验收过 Docker 部署，遇到问题欢迎提 Issue。

### 方式三：开发者从源码跑

需要 Node.js 22+、pnpm 12 与 PostgreSQL：

```bash
./setup.sh          # 装依赖、生成配置文件（不会覆盖你已有的配置）
pnpm run db:up      # 起本机数据库
pnpm run db:migrate # 建表
pnpm run dev        # 打开 http://localhost:3000
```

首次要在 `.env.local` 里填 `SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`，再执行 `pnpm run db:seed-admin`。
完整步骤见[新手上手指南](docs/getting-started.md)。

---

## 第一次打开，做这三件事

| 顺序 | 做什么 | 在哪 |
| --- | --- | --- |
| 1 | 设置管理员账号 | 首次打开页面会引导；或用上面的命令创建 |
| 2 | 改端口（可选） | 默认 3000。想用别的端口，把 `docker-compose.yml` 里 `"3000:3000"` 改成 `"8890:3000"`，重启即可 |
| 3 | 导入你自己的产品 | 「产品库 → 导入」。**这个版本的产品库是空的**：不附带客户资料、真实产品图片、渠道价格 |

产品资料怎么整理见[产品采集指南](docs/product-catalog-agent-guide.md)；产品参数与命名建议见[产品参数清单](docs/产品参数-按类别清单.md)。

---

## 日常维护（照着做就行）

| 我想… | 怎么做 |
| --- | --- |
| **备份数据** | `docker compose -f docker-compose.db.yml exec -T db pg_dump -U postgres fmkj > 备份-日期.sql` |
| **恢复备份** | `cat 备份-日期.sql \| docker compose -f docker-compose.db.yml exec -T db psql -U postgres -d fmkj` |
| **升级到新版本** | `git pull` → `docker compose build app` → `docker compose run --rm --no-deps app node scripts/run-migration.mjs` → `docker compose up -d app` |
| **忘记管理员密码** | 在 `.env.production` 填好 `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`，再跑一次 `docker compose run --rm --no-deps app node scripts/seed-admin.mjs` |
| **看程序有没有在跑** | `docker compose ps`；看日志 `docker compose logs -f app` |
| **数据存在哪** | 数据库在 Docker 数据卷里（`docker volume ls` 能看到）；想搬走用上面的备份命令 |
| **换一台机器** | 新机器按「方式二」装好，然后把备份文件恢复进去 |
| **让客户在手机上看** | 见[设备手册](docs/appliance-handbook.html)第 6 节（内网穿透 / 反向代理 / VPN） |
| **停掉不用了** | `docker compose down`（数据保留）；`docker compose -f docker-compose.db.yml down -v` 才会连数据一起删 |

---

## 常见问题

**Q：打开 `http://localhost:3000` 打不开？**
先运行 `docker compose ps`，确认 `fmkj-v3` 是 `Up`。如果是 `Restarting` 或 `Exit`，运行 `docker compose logs app | tail -30` 看报错；最常见的是 `.env.production` 里数据库地址或密钥没填对。

**Q：端口 3000 被别的软件占用了？**
把 `docker-compose.yml` 里的 `"3000:3000"` 改成 `"8890:3000"`，然后 `docker compose up -d app`，改用 `http://localhost:8890`。

**Q：它会把我的客户资料传到哪吗？**
不会。程序和数据库都跑在你自己机器上，没有对外上传。只有你自己配了云存储（`BLOB_READ_WRITE_TOKEN`）时，上传的附件才会走云端。

**Q：支持 Windows / Mac 吗？**
支持，装了 Docker Desktop 就行。机器人的 ARM 小主机（如黑豹 X2）也能跑。

**Q：为什么产品库是空的？**
开源版**刻意不带**任何客户资料、真实产品图片和渠道价格，避免把别人的商业信息带出来。你需要导入自己有权限使用的商品资料。

**Q：图片能批量导入吗？**
可以。产品表里有一列「图片地址」，支持本机图片路径或网址；导入时按[产品采集指南](docs/product-catalog-agent-guide.md)填写。

**Q：能商用吗？**
可以。项目自有代码是 MIT 许可，允许商用、修改和再分发（保留版权声明即可）。

**Q：出问题了从哪查？**
`docker compose logs app`（程序日志）、`docker compose -f docker-compose.db.yml logs db`（数据库日志）；源码方式还可以跑 `pnpm run doctor` 自检。

---

## 这个版本还没做到的事（先说清楚，不夸大）

| 项目 | 现状 |
| --- | --- |
| 附件上传 | 用的是公开链接，**拿到链接的人就能打开**；不适合放保密合同，正式使用前建议改造访问控制 |
| 短信 / 邮件通知 | 还没接供应商，相关界面不代表真的能发出去 |
| Docker 部署 | 还没在全新数据库上完整验收，遇到问题请提 Issue |
| 上传文件的持久化 | Docker 方式下没单独挂盘，重建容器前请备份 |
| 安全认证 | 做过脱敏与自查，但**没有**第三方安全认证或完整的依赖许可审计 |
| CAD / PDF 扩展 | 需要另行安装外部工具与字体，不随本仓库提供 |

---

## 想深入再看

**技术栈**：Next.js 16、React 19、TypeScript、PostgreSQL、Vitest。

| 命令 | 用途 |
| --- | --- |
| `pnpm run dev` / `build` / `start` | 开发模式 / 打包 / 生产模式 |
| `pnpm run typecheck` `test` `lint` | 类型检查 / 单元测试 / 代码规范 |
| `pnpm run doctor` | 自检仓库、配置和端口 |
| `pnpm run db:migrate` `db:check` `db:smoke` | 建表 / 结构检查 / 读写冒烟 |
| `pnpm run db:down` `db:reset` | 停数据库（保数据） / 连数据一起清空 |
| `pnpm run icons:build` | 生成点位图符号 |

**文档**：[新手上手](docs/getting-started.md) · [业务流程](docs/core-business-flow.md) · [点位设计](docs/point-map-design-workflow.md) · [视觉交付](docs/point-map-visual-presentation-workflow.md) · [环境变量](docs/environment.md) · [本地数据库](docs/local-database.md) · [Docker 部署](docs/deployment-docker.md) · [设备手册](docs/appliance-handbook.html) · [文档索引](docs/README.md)

**配置说明**：主要环境变量是 `DATABASE_URL`、`DATABASE_SSL`、`AUTH_SECRET`，模板见 [.env.example](.env.example)，完整说明见[环境变量文档](docs/environment.md)。生产环境请设 `AUTH_DEV_MODE=false`，并使用独立数据库和随机密钥；`.env.production` 不要提交到 Git。

**业务规则**：日常流程为「点位设计 → 报价单 → 客户交付」。默认型号允许作明确标识的未核验客户报价；项目换型只影响本项目；删除来源报价行会联动删除安装点与场景引用；客户出口使用固定交付版本。词汇见 [CONTEXT.md](CONTEXT.md)，决策记录见 [docs/adr](docs/adr/)。

**贡献与协作**：贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。用 AI 助手改代码时，请让它先读 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)。Issue 提到 `lynnliuyu/fmkj-smart-design` 的 Issues。

---

## 交流与反馈

用的时候卡住了、想要什么功能，或者只是想聊聊智能家居，都可以直接加我微信。
觉得这个工具帮到了你，也欢迎请我喝杯咖啡（完全自愿，不影响任何功能）。

| 加我微信 | 请我喝杯咖啡 |
| :---: | :---: |
| <img src="docs/assets/readme/wechat-contact.jpg" alt="加我微信" width="230"> | <img src="docs/assets/readme/wechat-sponsor.jpg" alt="赞助支持" width="230"> |
| 扫码加好友，备注「设计站」 | 扫码赞助，随缘就好 ☕ |

这个项目目前主要是我一个人在维护，消息通常在工作日晚上和周末回，慢一点请见谅。
也欢迎直接提 Issue：<https://github.com/lynnliuyu/fmkj-smart-design/issues>

---

## 许可证

Copyright (c) 2026 Contributors。项目自有代码采用 **MIT**，全文见 [LICENSE](LICENSE)：允许使用、修改、分发及商业使用，保留版权与许可声明即可。

依赖、第三方工具、字体与品牌商标保留各自权利，不因本项目的 MIT 而重新授权；已核对的直接依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
