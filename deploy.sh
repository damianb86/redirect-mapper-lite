#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ENV_FILE=${APP_ENV_FILE:-"$APP_DIR/.env"}

if [ -z "${SHARED_ENV_FILE:-}" ]; then
  SEARCH_DIR="$APP_DIR"
  while [ "$SEARCH_DIR" != "/" ]; do
    CANDIDATE="$SEARCH_DIR/shared-docker/.env"
    if [ -f "$CANDIDATE" ]; then
      SHARED_ENV_FILE="$CANDIDATE"
      break
    fi

    CANDIDATE="$SEARCH_DIR/../shared-docker/.env"
    if [ -f "$CANDIDATE" ]; then
      SHARED_ENV_FILE=$(CDPATH= cd -- "$(dirname -- "$CANDIDATE")" && pwd)/.env
      break
    fi

    SEARCH_DIR=$(dirname -- "$SEARCH_DIR")
  done
fi

if [ -z "${SHARED_ENV_FILE:-}" ] || [ ! -f "$SHARED_ENV_FILE" ]; then
  echo "Missing shared env file." >&2
  echo "Create it at a sibling shared-docker folder, for example:" >&2
  echo "  cd $(dirname -- "$APP_DIR")/shared-docker && cp .env.example .env" >&2
  echo "Or run with:" >&2
  echo "  SHARED_ENV_FILE=/absolute/path/to/shared-docker/.env ./deploy.sh" >&2
  exit 1
fi

if [ ! -f "$APP_ENV_FILE" ]; then
  echo "Missing app env file: $APP_ENV_FILE" >&2
  exit 1
fi

cd "$APP_DIR"
docker compose \
  --env-file "$SHARED_ENV_FILE" \
  --env-file "$APP_ENV_FILE" \
  up -d --build
