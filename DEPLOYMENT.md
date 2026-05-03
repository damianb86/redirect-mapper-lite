# Docker Deployment

This app uses the same shared infrastructure as Gift Message Bridge Lite:

- `../../shared-docker`: one Caddy Docker Proxy container, one PostgreSQL
  container, one shared Docker network.
- `./docker-compose.yml`: this app container plus a one-shot `db-init` job that
  creates this app's database and role in the shared PostgreSQL container.

Do not start Caddy or PostgreSQL from this app folder.

## First Server Setup

From the shared infra folder:

```sh
cd ../../shared-docker
cp .env.example .env
nano .env
docker compose up -d
```

## Deploy This App

From this app folder:

```sh
cp .env.example .env
nano .env
./deploy.sh
```

The deploy script reads both env files:

- `../../shared-docker/.env` for shared PostgreSQL admin access.
- `./.env` for this app's Shopify, SMTP, domain, and database settings.

## Requirements For Multiple Apps

- Use a unique `COMPOSE_PROJECT_NAME`.
- Use a unique `APP_HOST`.
- Use a unique `APP_DB_NAME` and `APP_DB_USER`.
- Keep `DATABASE_URL` pointed at `postgres`, never `localhost`.
- Keep a low Prisma `connection_limit`, such as `3`, on this small server.
