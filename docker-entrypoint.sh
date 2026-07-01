#!/bin/sh
# Jalankan migrasi Prisma lalu start API. Idempotent: migrate deploy hanya
# menerapkan migrasi yang belum dijalankan.
set -e

echo "==> prisma migrate deploy"
node_modules/.bin/prisma migrate deploy

# nest build bisa menaruh entry di dist/main.js atau dist/src/main.js
# (tergantung file di luar src/ yang ikut ter-compile, mis. prisma/seed.ts).
if [ -f dist/main.js ]; then
  MAIN=dist/main.js
else
  MAIN=dist/src/main.js
fi

echo "==> starting NestJS (node $MAIN)"
exec node "$MAIN"
