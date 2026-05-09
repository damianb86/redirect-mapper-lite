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
