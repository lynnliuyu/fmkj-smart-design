# Docker deployment

This project runs as a Next.js standalone container.

## Server setup

1. Install Docker with 1Panel.
2. Install PostgreSQL with 1Panel or use an external PostgreSQL provider.
3. Clone or pull this repository on the server.
4. Copy the production env template:

```bash
cp .env.production.example .env.production
```

5. Edit `.env.production` with real values.

For a PostgreSQL instance running on the same Docker host, use `host.docker.internal` in `DATABASE_URL` and keep this line in `docker-compose.yml`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

## Build and start

> 构建镜像需要至少 4GB Docker 内存（Next 编译在容器内跑）。Docker Desktop 默认常只有
> 1–2GB，会 OOM 并拖垮整个 Docker 守护进程。用 `node scripts/deploy/build-release.mjs`
> 发布时脚本会先检查内存；手工 `docker compose build` 前请自行确认。

```bash
docker compose build
docker compose up -d
```

## Run database migrations

Run migrations manually after the image is built and before opening the app to users:

```bash
docker compose run --rm app node scripts/run-migration.mjs
```

Seed or update an admin user when needed:

```bash
docker compose run --rm app node scripts/seed-admin.mjs
```

## Check logs

```bash
docker compose logs -f app
```

## 1Panel reverse proxy

Create a website in 1Panel and proxy the domain to:

```text
http://127.0.0.1:3000
```

Keep `AUTH_DEV_MODE=false` in production.
