#!/usr/bin/env bash
set -e

git pull
docker compose build app
docker compose up -d app
docker compose exec app npx prisma migrate deploy
docker compose ps
