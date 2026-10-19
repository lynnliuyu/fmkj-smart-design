# 新手上手指南

这个工具运行在你自己的电脑上，通过浏览器使用。第一次安装需要准备运行环境；以后打开时，不用重新安装。

## 1. 先准备这些工具

| 工具 | 用来做什么 | 安装入口 |
| --- | --- | --- |
| Git | 下载项目源码 | [Git 官网](https://git-scm.com/downloads) |
| Node.js | 运行网页程序，建议使用 24 LTS，最低支持 22 | [Node.js 中文下载页](https://nodejs.org/zh-cn/download) |
| pnpm 12 | 安装项目需要的依赖 | [pnpm 安装说明](https://pnpm.io/installation) |
| Docker Desktop | 在电脑上运行 PostgreSQL，用来保存项目和产品 | [Docker Desktop 官方说明](https://docs.docker.com/desktop/) |

安装 Node.js 后，可在终端执行 `npm install -g pnpm@12` 安装指定大版本。安装完成后，先打开 Docker Desktop，等它显示正在运行。

下面的命令适用于 macOS / Linux 的终端。Windows 用户需要在 WSL2 的 Linux 终端里准备 Node.js、pnpm 和 Git，并按 Docker 官方说明开启 WSL2 集成；Windows 原生命令行尚未单独验收。

## 2. 下载项目并准备配置

打开终端，一行一行执行：

```bash
git clone https://github.com/lynnliuyu/fmkj-smart-design.git
cd fmkj-smart-design
./setup.sh
```

`setup.sh` 会安装依赖，并在项目文件夹中创建 `.env.local`。这是你自己电脑的配置文件，已自动生成登录密钥；第一次可以保留其余默认值。已有配置不会被覆盖。

后续命令都在 `fmkj-smart-design` 文件夹内执行。首次安装可能需要等待依赖下载完成。

## 3. 启动保存数据的数据库

以下默认设置用于全新安装。如果电脑上已经运行过原业务版或有现成数据库，先看[数据库说明](local-database.md)，配置独立数据库，避免连接到已有业务资料。

```bash
pnpm run db:up
docker compose -f docker-compose.db.yml ps
```

当状态包含 `healthy`，说明数据库已准备好。然后创建系统需要的数据表：

```bash
pnpm run db:migrate
```

这里使用电脑上的 PostgreSQL，不需要先购买服务器或开通云数据库。

## 4. 创建你自己的管理员账号

用文本编辑器打开项目文件夹里的 `.env.local`，新增下面两行，并把示例内容换成你自己的邮箱和密码：

```dotenv
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=<你自己设置的至少12位密码>
```

这只是填写格式，不要原样使用示例密码。保存文件后，在终端执行：

```bash
pnpm run db:seed-admin
```

成功后记住自己设置的邮箱与密码，并从 `.env.local` 删除 `SEED_ADMIN_PASSWORD` 那一行。创建好的账号会保存在数据库中，不会因删除这行配置而消失。无需每次启动都创建账号；对同一邮箱再次执行会重置其密码和管理员权限。

## 5. 打开网页并登录

日常使用推荐生产模式，可减少开发工具的内存开销：

```bash
pnpm run build
pnpm run start
```

当终端显示服务已就绪，在浏览器打开 [http://localhost:3000](http://localhost:3000)，用刚才创建的邮箱和密码登录。暂不需要使用验证码登录。

服务运行时保留这个终端窗口；要关闭网页服务，在终端按 `Ctrl+C`。以后启动只需先确认 Docker 和数据库已运行，再执行 `pnpm run start`；更新源码后需重新执行 `pnpm run build`。

## 第一次登录后做什么

1. 到产品库添加你自己的设备型号、价格与有权使用的图片。
2. 创建一个客户项目，上传自己有权使用的户型图，再安排设备点位。
3. 整理报价，确认方案后按页面提示保存并生成客户交付版本。

刚安装时，产品、客户项目和历史方案列表为空是正常的。源码不附带真实客户资料、商品图库或渠道报价。未核验的默认型号报价会保留未核验标识，不表示可以直接采购施工。

## 常见问题

| 看到的情况 | 先检查什么 |
| --- | --- |
| `node` 或 `pnpm` 找不到 | 确认工具已安装，关闭终端后重新打开；执行 `node --version`、`pnpm --version` 检查 |
| 提示无法连接 Docker | 打开 Docker Desktop，等待它启动完成，再执行 `pnpm run db:up` |
| 无法连接数据库 | 查看 `docker compose -f docker-compose.db.yml ps`，确认包含 `healthy`，并核对 `.env.local` 连接配置 |
| 提示 3000 端口被占用 | 可能已有一个网页服务在运行，先访问本机地址；不要重复启动或随意结束其他程序 |
| 登录失败 | 使用第 4 步自己设置的邮箱和密码；先确认管理员创建成功，不要把它和 GitHub 登录混淆 |
| 产品库是空的 | 这是全新安装的正常状态，需要自行添加产品 |

若仍无法启动，执行 `pnpm run doctor` 收集诊断，提交问题时只提供脱敏的报错信息，不要上传 `.env.local` 或密码。

需要修改代码时再使用 `pnpm run dev`；不要与生产服务同时占用 3000 端口。附件云上传、CAD 和 PDF 扩展工具属于后续按需配置的功能，先完成上面的基础流程即可。
