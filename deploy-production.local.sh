#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

REMOTE_USER=${REMOTE_USER:-ubuntu}
REMOTE_HOST=${REMOTE_HOST:-3.135.94.213}
REMOTE_APP_DIR=${REMOTE_APP_DIR:-/opt/apps/redirect-mapper-lite}
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}
LOCAL_ENV_FILE=${LOCAL_ENV_FILE:-}
BUILD_COMMAND=${BUILD_COMMAND:-"npm run build:production"}
REMOTE_GIT_PULL_COMMAND=${REMOTE_GIT_PULL_COMMAND:-"git pull --ff-only"}
REMOTE_DEPLOY_COMMAND=${REMOTE_DEPLOY_COMMAND:-}
SSH_CONNECT_TIMEOUT_SECONDS=${SSH_CONNECT_TIMEOUT_SECONDS:-15}

if [ -n "${PEM_FILE:-}" ]; then
  :
elif [ -f "$APP_DIR/ssh.pem" ]; then
  PEM_FILE="$APP_DIR/ssh.pem"
elif [ -f "$APP_DIR/../ssh.pem" ]; then
  PEM_FILE="$APP_DIR/../ssh.pem"
elif [ -f "$APP_DIR/../LightsailDefaultKey-us-east-2.pem" ]; then
  PEM_FILE="$APP_DIR/../LightsailDefaultKey-us-east-2.pem"
else
  PEM_FILE="$APP_DIR/ssh.pem"
fi

SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"

if [ -z "$REMOTE_DEPLOY_COMMAND" ]; then
  REMOTE_DEPLOY_COMMAND="APP_ENV_FILE=$REMOTE_ENV_FILE BUILD_APP_BUNDLE=0 ./deploy.sh"
fi

start_step() {
  STEP_NAME=$1
  STEP_STARTED_AT=$(date +%s)
  printf '\n%s...\n' "$STEP_NAME"
}

finish_step() {
  STEP_FINISHED_AT=$(date +%s)
  printf '%s completed in %ss\n' "$STEP_NAME" "$((STEP_FINISHED_AT - STEP_STARTED_AT))"
}

require_file() {
  FILE=$1
  MESSAGE=$2
  if [ ! -f "$FILE" ]; then
    printf '%s\n' "$MESSAGE" >&2
    exit 1
  fi
}

require_command() {
  COMMAND=$1
  if ! command -v "$COMMAND" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$COMMAND" >&2
    exit 1
  fi
}

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

remote_env_path() {
  case "$REMOTE_ENV_FILE" in
    /*) printf '%s\n' "$REMOTE_ENV_FILE" ;;
    *) printf '%s/%s\n' "$REMOTE_APP_DIR" "$REMOTE_ENV_FILE" ;;
  esac
}

ssh_remote() {
  ssh \
    -i "$PEM_FILE" \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o "ConnectTimeout=$SSH_CONNECT_TIMEOUT_SECONDS" \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=2 \
    -o StrictHostKeyChecking=accept-new \
    "$@"
}

rsync_delete_dir() {
  SOURCE=$1
  DESTINATION=$2
  rsync -az --delete -e "$RSYNC_SSH" "$SOURCE" "$DESTINATION"
}

rsync_prisma_dir() {
  rsync -az --delete \
    --exclude dev.sqlite \
    --exclude dev.sqlite-journal \
    -e "$RSYNC_SSH" \
    "$APP_DIR/prisma/" \
    "$SSH_TARGET:$REMOTE_APP_DIR/prisma/"
}

cd "$APP_DIR"

if [ -z "$LOCAL_ENV_FILE" ]; then
  LOCAL_ENV_FILE="$APP_DIR/.env.production"
fi

require_command npm
require_command rsync
require_command ssh
require_file "$PEM_FILE" "Missing PEM file: $PEM_FILE. Run with PEM_FILE=/path/to/ssh.pem ./deploy-production.local.sh if it lives elsewhere."
require_file "$LOCAL_ENV_FILE" "Missing production env file: $LOCAL_ENV_FILE"

chmod 400 "$PEM_FILE" 2>/dev/null || true
RSYNC_SSH="ssh -i $(shell_quote "$PEM_FILE") -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=$SSH_CONNECT_TIMEOUT_SECONDS -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new"

printf 'Deploying Redirect Pulse: Bulk Redirects production build\n'
printf '  local app:   %s\n' "$APP_DIR"
printf '  build env:   %s\n' "$LOCAL_ENV_FILE"
printf '  server:      %s\n' "$SSH_TARGET"
printf '  remote app:  %s\n' "$REMOTE_APP_DIR"
if [ -n "$REMOTE_ENV_FILE" ]; then
  printf '  runtime env: %s\n' "$(remote_env_path)"
else
  printf '  runtime env: auto (.env)\n'
fi
printf '  pem:         %s\n' "$PEM_FILE"
if [ -n "$REMOTE_GIT_PULL_COMMAND" ]; then
  printf '  remote git:  %s\n' "$REMOTE_GIT_PULL_COMMAND"
else
  printf '  remote git:  disabled\n'
fi

start_step "Building production bundle locally"
APP_ENV_FILE="$LOCAL_ENV_FILE" sh -c "$BUILD_COMMAND"
finish_step

require_file "$APP_DIR/build/server/index.js" "Missing build/server/index.js after build."

start_step "Checking remote app directory"
REMOTE_CHECK_COMMAND="REMOTE_APP_DIR=$(shell_quote "$REMOTE_APP_DIR") sh -s"
ssh_remote "$SSH_TARGET" "$REMOTE_CHECK_COMMAND" <<'REMOTE_CHECK'
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ ! -d "$REMOTE_APP_DIR" ]; then
  fail "Missing remote app directory: $REMOTE_APP_DIR"
fi

if [ ! -f "$REMOTE_APP_DIR/deploy.sh" ]; then
  fail "Missing remote deploy script: $REMOTE_APP_DIR/deploy.sh"
fi

if [ ! -x "$REMOTE_APP_DIR/deploy.sh" ]; then
  fail "Remote deploy script is not executable. Run: chmod +x $REMOTE_APP_DIR/deploy.sh"
fi
REMOTE_CHECK
finish_step

if [ -n "$REMOTE_GIT_PULL_COMMAND" ]; then
  start_step "Updating remote code from Git"
  REMOTE_APP_DIR_QUOTED=$(shell_quote "$REMOTE_APP_DIR")
  ssh_remote "$SSH_TARGET" "cd $REMOTE_APP_DIR_QUOTED && $REMOTE_GIT_PULL_COMMAND"
  finish_step
fi

start_step "Uploading production env file"
REMOTE_ENV_PATH=$(remote_env_path)
REMOTE_ENV_DIR=$(dirname -- "$REMOTE_ENV_PATH")
ssh_remote "$SSH_TARGET" "mkdir -p $(shell_quote "$REMOTE_ENV_DIR")"
rsync -az -e "$RSYNC_SSH" "$LOCAL_ENV_FILE" "$SSH_TARGET:$REMOTE_ENV_PATH"
ssh_remote "$SSH_TARGET" "chmod 600 $(shell_quote "$REMOTE_ENV_PATH")"
finish_step

start_step "Uploading runtime files to production server"
rsync_delete_dir "$APP_DIR/build/" "$SSH_TARGET:$REMOTE_APP_DIR/build/"
rsync_prisma_dir
rsync_delete_dir "$APP_DIR/scripts/" "$SSH_TARGET:$REMOTE_APP_DIR/scripts/"
rsync_delete_dir "$APP_DIR/public/" "$SSH_TARGET:$REMOTE_APP_DIR/public/"
rsync -az -e "$RSYNC_SSH" \
  "$APP_DIR/.dockerignore" \
  "$APP_DIR/Dockerfile" \
  "$APP_DIR/deploy.sh" \
  "$APP_DIR/docker-compose.yml" \
  "$APP_DIR/package.json" \
  "$APP_DIR/package-lock.json" \
  "$APP_DIR/server.mjs" \
  "$SSH_TARGET:$REMOTE_APP_DIR/"
finish_step

start_step "Running remote deploy"
REMOTE_APP_DIR_QUOTED=$(shell_quote "$REMOTE_APP_DIR")
ssh_remote "$SSH_TARGET" "cd $REMOTE_APP_DIR_QUOTED && $REMOTE_DEPLOY_COMMAND"
finish_step

printf '\nProduction deploy complete.\n'
