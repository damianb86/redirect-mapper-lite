#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ENV_FILE=${APP_ENV_FILE:-"$APP_DIR/.env"}

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

cd "$APP_DIR"

echo "Deploying Redirect Mapper Lite"
echo "  app env:    $APP_ENV_FILE"
echo "  shared env: $SHARED_ENV_FILE"
echo
echo "Validating docker-compose.yml with both env files..."
compose config >/dev/null

echo "Building and starting containers..."
compose up -d --build --remove-orphans

BILLING_TEST=$(compose exec -T app printenv SHOPIFY_BILLING_TEST 2>/dev/null || true)
if [ -n "$BILLING_TEST" ]; then
  echo "SHOPIFY_BILLING_TEST inside app container: $BILLING_TEST"
else
  echo "Warning: could not read SHOPIFY_BILLING_TEST from the app container." >&2
fi

echo "Deploy complete."
