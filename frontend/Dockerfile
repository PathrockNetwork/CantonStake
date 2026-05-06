# syntax=docker/dockerfile:1.7
#
# Build is split into 3 stages so layers cache independently:
#   1. deps:    package*.json only → npm ci with a BuildKit cache mount.
#   2. builder: source + already-installed node_modules → next build.
#   3. runner:  copies ONLY .next/standalone + .next/static + public.
#
# The runner image is ~150 MB instead of ~1 GB because Next.js standalone
# output traces only the deps actually imported at runtime.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_MOCK_VALIDATOR_SHARE
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_MOCK_LOOP_PARTY_ID
ARG NEXT_PUBLIC_LOOP_NETWORK
ARG NEXT_PUBLIC_LOOP_SDK_ENABLED
ARG NEXT_PUBLIC_CC_USD
ARG NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE
ARG NEXT_PUBLIC_REAL_VALIDATOR_SHARES
ARG NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY
ARG NEXT_PUBLIC_LOOP_API_URL
ARG NEXT_PUBLIC_LOOP_WALLET_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_MOCK_VALIDATOR_SHARE=$NEXT_PUBLIC_MOCK_VALIDATOR_SHARE
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_MOCK_LOOP_PARTY_ID=$NEXT_PUBLIC_MOCK_LOOP_PARTY_ID
ENV NEXT_PUBLIC_LOOP_NETWORK=$NEXT_PUBLIC_LOOP_NETWORK
ENV NEXT_PUBLIC_LOOP_SDK_ENABLED=$NEXT_PUBLIC_LOOP_SDK_ENABLED
ENV NEXT_PUBLIC_CC_USD=$NEXT_PUBLIC_CC_USD
ENV NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=$NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE
ENV NEXT_PUBLIC_REAL_VALIDATOR_SHARES=$NEXT_PUBLIC_REAL_VALIDATOR_SHARES
ENV NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY=$NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY
ENV NEXT_PUBLIC_LOOP_API_URL=$NEXT_PUBLIC_LOOP_API_URL
ENV NEXT_PUBLIC_LOOP_WALLET_URL=$NEXT_PUBLIC_LOOP_WALLET_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Standalone output puts a self-contained server.js + minimal node_modules
# in .next/standalone. Static assets stay in .next/static, public in public.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
