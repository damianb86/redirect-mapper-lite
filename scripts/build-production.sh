#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${APP_ENV_FILE:-}

if [ -z "$ENV_FILE" ]; then
  if [ -f "$APP_DIR/.env.production" ]; then
    ENV_FILE="$APP_DIR/.env.production"
  elif [ -f "$APP_DIR/.production" ]; then
    ENV_FILE="$APP_DIR/.production"
  else
    ENV_FILE="$APP_DIR/.env"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Create .env.production, .production, .env, or pass APP_ENV_FILE=/path/to/env." >&2
  exit 1
fi

eval "$(node "$APP_DIR/scripts/print-shell-env.mjs" "$ENV_FILE")"

cd "$APP_DIR"

APP_ENV=${BUILD_APP_ENV:-production}
NODE_OPTIONS=${BUILD_NODE_OPTIONS:-"--max-old-space-size=4096"}
export APP_ENV NODE_OPTIONS
npm run build
