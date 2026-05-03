#!/bin/sh
set -eu

: "${PGHOST:?Missing PGHOST}"
: "${PGPORT:?Missing PGPORT}"
: "${PGDATABASE:?Missing PGDATABASE}"
: "${PGUSER:?Missing PGUSER}"
: "${PGPASSWORD:?Missing PGPASSWORD}"
: "${APP_DB_NAME:?Missing APP_DB_NAME}"
: "${APP_DB_USER:?Missing APP_DB_USER}"
: "${APP_DB_PASSWORD:?Missing APP_DB_PASSWORD}"

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"; do
  sleep 2
done

psql \
  -v ON_ERROR_STOP=1 \
  -v app_db="$APP_DB_NAME" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$PGDATABASE" <<-'EOSQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT FROM pg_catalog.pg_roles WHERE rolname = :'app_user'
)\gexec

SELECT format(
  'ALTER ROLE %I PASSWORD %L',
  :'app_user',
  :'app_password'
)\gexec

SELECT format(
  'CREATE DATABASE %I OWNER %I',
  :'app_db',
  :'app_user'
)
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = :'app_db'
)\gexec

SELECT format(
  'GRANT ALL PRIVILEGES ON DATABASE %I TO %I',
  :'app_db',
  :'app_user'
)\gexec
EOSQL
