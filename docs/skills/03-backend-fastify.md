# Skill: Backend - Fastify 5 + viem + Canton JSON API v2 + Prisma/BullMQ

## When to use
Any work in `backend/`: Fastify routes, env/config, the Canton client, Amoy event orchestration, Prisma models, or the reward scheduler.

## Key Files
- `backend/src/index.ts` - Fastify server and API routes
- `backend/src/config.ts` - env parsing and defaults
- `backend/src/canton.ts` - JSON Ledger API v2 client
- `backend/src/orchestrator.ts` - viem watchers and release checker
- `backend/src/db.ts` - Prisma client singleton
- `backend/src/reward-rounds.ts` - BullMQ reward scheduler
- `backend/prisma/schema.prisma` - PostgreSQL schema
- `backend/package.json` - runtime versions and scripts

## Actual Stack
- Fastify 5
- `@fastify/cors` 11
- TypeScript + ESM
- viem for Polygon Amoy reads
- Prisma 5 + PostgreSQL
- BullMQ + ioredis + Redis
- dotenv for env loading

## Architecture Reality Check
- The Canton ledger is still the main source of truth for staking requests and positions
- `backend/src/canton.ts` and `backend/src/orchestrator.ts` are the critical path for the real staking flow
- Prisma and BullMQ were added later for reward persistence/scheduling
- The database layer is not yet a full mirror of the Canton state machine
- Do not assume DB-backed reward code is authoritative unless you verify the Canton-to-DB sync path

## ESM Rule
All local imports must use `.js`:

```ts
import { config } from "./config.js";
```

## Canton JSON API Usage
`backend/src/canton.ts` currently wraps:

```text
POST /v2/commands/submit-and-wait-for-transaction
POST /v2/state/active-contracts
```

The backend uses:
- `CreateCommand` to create `StakingRequest`
- `ExerciseCommand` to accept bond, confirm unbond, and release positions
- party-scoped ACS queries for `StakingRequest` and `StakingPosition`

## Fastify Route Pattern
- Register plugins and routes before `app.listen(...)`
- Keep validation simple unless the repo already uses a schema layer
- Log server errors with `req.log.error(err)`
- Return structured JSON errors to the frontend

Example:

```ts
app.post<{ Body: MyRequestBody }>("/api/my-endpoint", async (req, reply) => {
  try {
    return { ok: true };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: String(err) });
  }
});
```

## Current API Surface
- `POST /api/requests`
- `GET /api/requests`
- `GET /api/positions`
- `GET /api/rewards/:address`
- `GET /api/health`

There is also a `/api/health/detail` route in the current tree, but it is currently registered after `app.listen(...)`. Move route registration above `listen` before relying on it.

## Config Rules
Use the exported `config` object from `backend/src/config.ts`.

Important vars:
- `PORT`
- `LOG_LEVEL`
- `AMOY_RPC_URL`
- `MOCK_VALIDATOR_SHARE_ADDRESS`
- `CANTON_JSON_API_URL`
- `CANTON_APP_PROVIDER_PARTY`
- `CANTON_AUTH_TOKEN`
- `FEATURED_APP_RIGHT_CID`
- `DATABASE_URL`
- `REDIS_URL`

## Prisma Notes
- Prisma reads `DATABASE_URL` from `schema.prisma`
- The fallback in `backend/src/config.ts` does not automatically satisfy Prisma CLI/runtime requirements
- After schema changes:

```bash
npx prisma generate
npx prisma migrate dev
```

- Current schema models:
  - `User`
  - `StakingPosition`
  - `RewardRound`
  - `RewardEvent`

## Reward Scheduler Notes
- `startRewardScheduler()` lives in `backend/src/reward-rounds.ts`
- Uses BullMQ and Redis
- Persists mock CC rounds into PostgreSQL
- Currently reads bonded positions from Prisma, not directly from the ledger
- This means reward logic can drift from the real Canton state if DB rows are not populated correctly

## Known Backend Pitfalls In This Repo
- Registering routes after `app.listen(...)` causes Fastify runtime errors
- Prisma may fail even if `config.databaseUrl` has a fallback, because Prisma itself needs `DATABASE_URL`
- The DB reward layer is currently only partially wired to the Canton flow
- Placeholder template IDs in `backend/src/canton.ts` can break real participant queries
- If `FEATURED_APP_RIGHT_CID` and `CANTON_APP_PROVIDER_PARTY` do not belong together, marker-related flows fail in confusing ways

## Common Mistakes
- Do not use JSON API v1 examples with this backend
- Do not assume the DB is the canonical staking source
- Do not import local modules without `.js`
- Do not read `process.env` throughout the codebase when `config` already exposes the value
- Do not add new routes below `await app.listen(...)`
- Do not change Fastify plugin versions independently from the Fastify major version
