# ---- Build stage ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Enable pnpm via corepack.
RUN corepack enable

# Install dependencies (cached unless the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Generate the Prisma client and build the app.
COPY . .
RUN pnpm prisma generate && pnpm build

# ---- Runtime stage -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Bawa node_modules lengkap dari builder: berisi @prisma/client (runtime) DAN
# Prisma CLI (dipakai `migrate deploy` saat start). Disalin satu kesatuan agar
# symlink pnpm tetap utuh.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Entrypoint: prisma migrate deploy -> node dist/main.js
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
