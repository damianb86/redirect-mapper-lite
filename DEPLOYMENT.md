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

## Deploy Production From Local

Use `deploy-production.local.sh` from your local machine when you want to avoid
building the React Router bundle on the production server:

```sh
./deploy-production.local.sh
```

The local deploy script:

- loads `.env.production`, `.production`, or `.env` for build-time variables;
- forces `APP_ENV=production` while building locally;
- runs `npm run build:production`;
- uploads `build/`, runtime files, Prisma files, scripts, and public assets to
  `/opt/apps/redirect-mapper-lite`;
- runs the remote deploy as `BUILD_APP_BUNDLE=0 ./deploy.sh`.

Useful overrides:

```sh
PEM_FILE=/path/to/ssh.pem ./deploy-production.local.sh
REMOTE_HOST=example.com REMOTE_APP_DIR=/opt/apps/redirect-mapper-lite ./deploy-production.local.sh
LOCAL_ENV_FILE=.env.production ./deploy-production.local.sh
REMOTE_GIT_PULL_COMMAND= ./deploy-production.local.sh
```

On the server, `deploy.sh` now expects a prebuilt `build/server/index.js` when
`BUILD_APP_BUNDLE=0`. Its default `BUILD_APP_BUNDLE=auto` still allows local
server-side builds on machines that have dev dependencies installed.

## Environment Modes

This app follows the same environment split as ReplyPilot:

- `APP_ENV=development` is the default local mode. Prisma uses
  `prisma/schema.dev.prisma` and `DEV_DATABASE_URL`, which defaults to
  `file:./dev.sqlite`.
- `APP_ENV=production` uses PostgreSQL through `prisma/schema.prisma`.
  Docker Compose derives the production `DATABASE_URL` from `APP_DB_NAME`,
  `APP_DB_USER`, and `APP_DB_PASSWORD`, always pointing at the shared
  PostgreSQL service hostname `postgres`.

Local development commands should use the npm scripts:

```sh
npm run setup
npm run dev
```

Do not run `npx prisma migrate deploy` directly in local development. That
command is production-only and requires `APP_ENV=production` plus a reachable
PostgreSQL database.

## Requirements For Multiple Apps

- Use a unique `COMPOSE_PROJECT_NAME`.
- Use a unique `APP_HOST`.
- Use a unique `APP_DB_NAME` and `APP_DB_USER`.
- Keep production database connections pointed at `postgres`, never `localhost`.
- Keep a low Prisma `connection_limit`, such as `3`, on this small server.

## Logs And Debugging

The app writes structured JSON logs to stdout and to an app-specific file mounted
from `./logs` by Docker Compose:

```sh
./logs/redirect-mapper-lite.jsonl
```

Each entry includes timestamp, level, app name, event, request id, route,
method, path, status, duration, shop when available, and a redacted error object.
Secrets, tokens, HMAC values, OAuth codes, cookies, and authorization headers are
redacted before logging.

Production starts through `server.mjs` instead of `react-router-serve` so access
logs are sanitized before they reach Docker stdout. This avoids leaking Shopify
OAuth/session query parameters in container logs.

Useful production commands from your local machine:

```sh
# Current Docker stdout/stderr logs for this app
ssh -i ../../ssh.pem ubuntu@3.135.94.213 \
  'docker logs --since 24h --tail 300 redirect-mapper-lite-app-1'

# Follow structured app logs
ssh -i ../../ssh.pem ubuntu@3.135.94.213 \
  'tail -f /opt/apps/redirect-mapper-lite/logs/redirect-mapper-lite.jsonl'

# Show warnings and errors from structured logs
ssh -i ../../ssh.pem ubuntu@3.135.94.213 \
  'grep -E "\"level\":\"(warn|error)\"" /opt/apps/redirect-mapper-lite/logs/redirect-mapper-lite.jsonl | tail -n 100'

# Check reverse proxy / TLS logs
ssh -i ../../ssh.pem ubuntu@3.135.94.213 \
  'docker logs --since 24h --tail 300 shared-shopify-infra-caddy-1'
```

Runtime logging environment:

```env
APP_NAME=redirect-mapper-lite
LOG_LEVEL=info
LOG_DIR=/app/logs
LOG_TO_FILE=true
APP_LOG_DIR=./logs
```

Use `LOG_LEVEL=debug` temporarily when you need request start events and more
diagnostic detail. Keep `info` in normal production use.
