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
RUN corepack enable

# Install production dependencies only.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy build artefacts and the generated Prisma client/schema.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/main.js"]
