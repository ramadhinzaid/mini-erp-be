#!/bin/sh
# Jalankan migrasi Prisma lalu start API. Idempotent: migrate deploy hanya
# menerapkan migrasi yang belum dijalankan.
set -e

echo "==> prisma migrate deploy"
node_modules/.bin/prisma migrate deploy

# Seed admin (idempotent: seed.ts pakai upsert, aman dijalankan tiap start).
# Jalankan hasil compile bila ada; fallback ke `prisma db seed` (ts-node).
echo "==> seeding admin (idempotent)"
if [ -f dist/prisma/seed.js ]; then
  node dist/prisma/seed.js
elif [ -f dist/src/prisma/seed.js ]; then
  node dist/src/prisma/seed.js
else
  node_modules/.bin/prisma db seed
fi

# nest build bisa menaruh entry di dist/main.js atau dist/src/main.js
# (tergantung file di luar src/ yang ikut ter-compile, mis. prisma/seed.ts).
if [ -f dist/main.js ]; then
  MAIN=dist/main.js
else
  MAIN=dist/src/main.js
fi

echo "==> starting NestJS (node $MAIN)"
exec node "$MAIN"
