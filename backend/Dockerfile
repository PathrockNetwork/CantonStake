# syntax=docker/dockerfile:1.7
#
# Three-stage build with BuildKit cache mounts. The npm cache survives
# between deploys and `npm ci` is deterministic against the lockfile.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev
RUN npx prisma generate

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY tsconfig.json ./
COPY package.json package-lock.json ./
COPY src ./src
RUN npm run build

# Pruned production deps go in their own stage so the runner image
# doesn't carry @types/* / typescript / vitest into prod.
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev
RUN npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
EXPOSE 4001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
