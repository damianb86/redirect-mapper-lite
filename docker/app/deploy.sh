#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
APP_ENV_FILE=${APP_ENV_FILE:-"$APP_DIR/.env"}

if [ -z "${SHARED_ENV_FILE:-}" ]; then
  if [ -f "$APP_DIR/../shared-docker/.env" ]; then
    SHARED_ENV_FILE="$APP_DIR/../shared-docker/.env"
  else
    SHARED_ENV_FILE="$APP_DIR/../../shared-docker/.env"
  fi
fi

if [ ! -f "$SHARED_ENV_FILE" ]; then
  echo "Missing shared env file: $SHARED_ENV_FILE" >&2
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
