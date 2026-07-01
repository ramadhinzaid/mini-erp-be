#!/bin/sh
# Jalankan migrasi Prisma lalu start API. Idempotent: migrate deploy hanya
# menerapkan migrasi yang belum dijalankan.
set -e

echo "==> prisma migrate deploy"
node_modules/.bin/prisma migrate deploy

echo "==> starting NestJS (node dist/main.js)"
exec node dist/main.js
