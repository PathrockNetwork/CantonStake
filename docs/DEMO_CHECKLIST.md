# CantonStake Demo Checklist

Run this before every live demo. If any required step fails, use the backup recording.

## Required Setup

0. Run local preflight.
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/demo-preflight.ps1
   ```
   Required for full smoke: `docker`, `daml`, root `.env`, `backend/.env`, `frontend/.env.local`, `evm/.env`, and the Splice DAR.

1. Start Canton LocalNet from CN Quickstart.
   ```bash
   cd ../cn-quickstart/quickstart
   make start
   ```

2. Start persistence.
   ```bash
   docker compose up -d postgres redis
   ```

3. Apply database migrations.
   ```bash
   cd backend
   npx prisma migrate deploy
   ```

4. Confirm `.env` has demo-safe values.
   ```bash
   DEMO_MODE=true
   FEATURED_APP_RIGHT_CID=demo-stub
   NEXT_PUBLIC_MOCK_LOOP_PARTY_ID=Alice::1220...
   MOCK_VALIDATOR_SHARE_ADDRESS=0x...
   CANTON_APP_PROVIDER_PARTY=CantonStake::1220...
   CANTON_DELEGATOR_PARTY=Alice::1220...
   ```

5. Start backend and frontend.
   ```bash
   cd backend && npm run dev
   cd frontend && npm run dev
   ```

6. Health check.
   ```bash
   curl http://localhost:4001/api/health/detail
   ```
   Required: `database=connected`, `redis=connected`, `featuredAppRight=configured`.
   With `FEATURED_APP_RIGHT_CID=demo-stub`, the scheduler runs but Daml marker exercise is intentionally disabled.

## Live Flow

1. Open `http://localhost:3000/stake`.
2. Connect Loop. Confirm TopNav shows the Loop party and `0.00 CC`.
3. Connect MetaMask or Ledger/WalletConnect.
4. Switch to Polygon Amoy and confirm at least `0.5 POL`.
5. Stake `0.1 POL`.
6. Wait for the trace: Canton request created, Amoy tx confirmed, orchestrator accepts, marker emitted.
7. Open `/positions`; confirm one `Bonded` position.
8. Confirm Postgres mirror.
   ```bash
   docker exec -it cantonstake-postgres psql -U cantonstake -d cantonstake \
     -c 'select "evmAddress", "status", "amountPol", "markersEmitted" from "StakingPosition";'
   ```
9. Trigger a demo reward round.
   ```bash
   curl -X POST http://localhost:4001/api/admin/rounds/trigger
   ```
10. Open `/rewards`; confirm `cc earned > 0` and the 75/25 split.
11. On `/positions`, click `Sweep`; then open `/rewards` and confirm native sweep / protocol fee totals update.
12. On `/positions`, click `Unbond`.
13. Wait 60 seconds; confirm `/positions` shows `Released`.

## Backup Checks

- Use `docs/DEMO_RECORDING_SCRIPT.md` to record the 3-minute fallback video after this checklist passes once.
- If reward round is skipped, check `FEATURED_APP_RIGHT_CID` and `/api/health/detail`.
- If you want real `FeaturedAppActivityMarker` contracts, replace `demo-stub` with the actual `FeaturedAppRight` contract id owned by `CANTON_APP_PROVIDER_PARTY`.
- If manual trigger returns 403, set `DEMO_MODE=true` or `LOG_LEVEL=debug`.
- If no Bonded row appears in Postgres, check backend orchestrator logs for the `ShareMinted` transaction hash.
- If Canton request creation fails after Loop connect, set `NEXT_PUBLIC_MOCK_LOOP_PARTY_ID` to a party hosted on the delegator participant and rebuild/restart the frontend.
