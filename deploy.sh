#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ENV_FILE=${APP_ENV_FILE:-"$APP_DIR/.env"}
APP_DISPLAY_NAME=${APP_DISPLAY_NAME:-"Redirect Pulse: Bulk Redirects"}
VERIFY_ENV_VARS=${VERIFY_ENV_VARS:-"SHOPIFY_BILLING_TEST"}
VERIFY_SECRET_ENV_VARS=${VERIFY_SECRET_ENV_VARS:-"OPENAI_API_KEY"}
BUILD_APP_BUNDLE=${BUILD_APP_BUNDLE:-auto}
DOCKER_BUILDKIT=${DOCKER_BUILDKIT:-1}
COMPOSE_DOCKER_CLI_BUILD=${COMPOSE_DOCKER_CLI_BUILD:-1}
export DOCKER_BUILDKIT COMPOSE_DOCKER_CLI_BUILD

resolve_file() {
  FILE=$1
  if [ -f "$FILE" ]; then
    FILE_DIR=$(CDPATH= cd -- "$(dirname -- "$FILE")" && pwd)
    printf '%s/%s\n' "$FILE_DIR" "$(basename -- "$FILE")"
  else
    printf '%s\n' "$FILE"
  fi
}

find_shared_env_file() {
  SEARCH_DIR="$APP_DIR"
  while [ "$SEARCH_DIR" != "/" ]; do
    for CANDIDATE in \
      "$SEARCH_DIR/shared-docker/.env" \
      "$SEARCH_DIR/../shared-docker/.env"
    do
      if [ -f "$CANDIDATE" ]; then
        resolve_file "$CANDIDATE"
        return 0
      fi
    done

    SEARCH_DIR=$(dirname -- "$SEARCH_DIR")
  done

  return 1
}

compose() {
  docker compose \
    --env-file "$SHARED_ENV_FILE" \
    --env-file "$APP_ENV_FILE" \
    "$@"
}

start_step() {
  STEP_NAME=$1
  STEP_STARTED_AT=$(date +%s)
  echo "$STEP_NAME..."
}

finish_step() {
  STEP_FINISHED_AT=$(date +%s)
  echo "$STEP_NAME completed in $((STEP_FINISHED_AT - STEP_STARTED_AT))s"
  echo
}

APP_ENV_FILE=$(resolve_file "$APP_ENV_FILE")

if [ -n "${SHARED_ENV_FILE:-}" ]; then
  SHARED_ENV_FILE=$(resolve_file "$SHARED_ENV_FILE")
else
  SHARED_ENV_FILE=$(find_shared_env_file || true)
fi

if [ -z "${SHARED_ENV_FILE:-}" ] || [ ! -f "$SHARED_ENV_FILE" ]; then
  echo "Missing shared env file." >&2
  echo "Expected a shared-docker/.env file with POSTGRES_ADMIN_PASSWORD." >&2
  echo "Create it next to the app folders, for example:" >&2
  echo "  $(dirname -- "$APP_DIR")/shared-docker/.env" >&2
  echo "Or pass an explicit path:" >&2
  echo "  SHARED_ENV_FILE=/absolute/path/to/shared-docker/.env ./deploy.sh" >&2
  exit 1
fi

if [ ! -f "$APP_ENV_FILE" ]; then
  echo "Missing app env file: $APP_ENV_FILE" >&2
  exit 1
fi

if ! grep -Eq '^[[:space:]]*POSTGRES_ADMIN_PASSWORD=.+' "$SHARED_ENV_FILE"; then
  echo "Missing POSTGRES_ADMIN_PASSWORD in shared env file: $SHARED_ENV_FILE" >&2
  exit 1
fi

APP_DATABASE_URL=$(
  grep -E '^[[:space:]]*DATABASE_URL=' "$APP_ENV_FILE" \
    | tail -n 1 \
    | sed 's/^[^=]*=//' \
    | sed "s/^[\"']//; s/[\"']$//" \
    || true
)
case "$APP_DATABASE_URL" in
  *@127.0.0.1:*|*@localhost:*|*@0.0.0.0:*)
    echo "DATABASE_URL points to a loopback host, which will not work from the app container." >&2
    echo "Use the shared PostgreSQL service hostname instead, for example:" >&2
    echo "  DATABASE_URL=postgresql://<app-db-user>:<password>@postgres:5432/<app-db-name>?schema=public&connection_limit=3" >&2
    exit 1
    ;;
esac

cd "$APP_DIR"

echo "Deploying $APP_DISPLAY_NAME"
echo "  app env:    $APP_ENV_FILE"
echo "  shared env: $SHARED_ENV_FILE"
echo
start_step "Validating docker-compose.yml with both env files"
compose config >/dev/null
finish_step

start_step "Initializing database role and database"
compose up \
  --no-deps \
  --force-recreate \
  --abort-on-container-exit \
  --exit-code-from db-init \
  db-init
finish_step

if [ "$BUILD_APP_BUNDLE" = "auto" ]; then
  if [ -x "$APP_DIR/node_modules/.bin/react-router" ]; then
    BUILD_APP_BUNDLE=1
  else
    BUILD_APP_BUNDLE=0
  fi
fi

if [ "$BUILD_APP_BUNDLE" = "1" ]; then
  start_step "Building app bundle outside Docker"
  npm run build
  finish_step
fi

if [ ! -f "$APP_DIR/build/server/index.js" ]; then
  echo "Missing build output: $APP_DIR/build/server/index.js" >&2
  echo "This server should deploy a prebuilt bundle instead of compiling React Router/Vite inside Docker." >&2
  echo "Build locally and copy the build directory to the server:" >&2
  echo "  npm run build:production" >&2
  echo "  rsync -az --delete build/ user@server:$APP_DIR/build/" >&2
  echo "Then run deploy again:" >&2
  echo "  BUILD_APP_BUNDLE=0 ./deploy.sh" >&2
  exit 1
fi

start_step "Building and starting app container"
compose up -d --build --remove-orphans --no-deps app
finish_step

if [ -n "$VERIFY_ENV_VARS" ]; then
  start_step "Verifying selected app environment variables"
  for ENV_VAR in $VERIFY_ENV_VARS; do
    VALUE=$(compose exec -T app printenv "$ENV_VAR" 2>/dev/null || true)
    if [ -n "$VALUE" ]; then
      echo "$ENV_VAR inside app container: $VALUE"
    else
      echo "Warning: could not read $ENV_VAR from the app container." >&2
    fi
  done
  finish_step
fi

if [ -n "$VERIFY_SECRET_ENV_VARS" ]; then
  start_step "Verifying selected secret environment variables"
  for ENV_VAR in $VERIFY_SECRET_ENV_VARS; do
    STATUS=$(compose exec -T app sh -c '
      VALUE=$(printenv "$1" 2>/dev/null || true)
      if [ -n "$VALUE" ]; then
        printf "present length %s\n" "${#VALUE}"
      fi
    ' sh "$ENV_VAR" 2>/dev/null || true)
    if [ -n "$STATUS" ]; then
      echo "$ENV_VAR inside app container: $STATUS"
    else
      echo "Warning: $ENV_VAR is not set inside the app container." >&2
    fi
  done
  finish_step
fi

start_step "Reading app container status"
compose ps app
finish_step
echo "Deploy complete."
