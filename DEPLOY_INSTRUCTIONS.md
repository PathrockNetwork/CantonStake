# CantonStake — Hackathon Deploy (Step-by-Step)

## What's done

1. **EVM contract deployed** to Polygon Amoy: `0xE7AE1663eAFf0E1DF071240B1c7Dc2e1Fc816729`
2. **Canton LocalNet running** (cn-quickstart)
3. **DAML package built** (`cantonstake-0.0.1.dar`) and uploaded to LocalNet
4. **All .env files configured** with contract address + party IDs
5. **Backend + frontend deps installed**

## Current party IDs

| Role | Party ID |
|---|---|
| App Provider (CantonStake) | `app_provider_quickstart-root-1::1220345f9a1202551be2361e5c07312bc9ef9d0a5709116dcc051d966e4164e031b3` |
| Delegator (Alice) | `app_user_quickstart-root-1::12206bfd71346d6f636341376a5ac3d8c13ff6f3ebe4ff9be9716c73aa612e80f9de` |

## Remaining steps

### 1. Self-feature via Canton Coin Wallet

1. Open http://wallet.localhost:2000 in a browser
2. Log in as the app provider party
3. Tap "Self-feature" to get a `FeaturedAppRight`
4. Copy the contract ID into `.env` files as `FEATURED_APP_RIGHT_CID`

### 2. Start CantonStake

```bash
cd /root/CantonStake
docker compose up --build
```

Or run locally:
```bash
# Terminal 1: infra
docker compose up postgres redis

# Terminal 2: backend
cd backend && npm run dev

# Terminal 3: frontend
cd frontend && npm run dev
```

### 3. Configure MetaMask

- Network: Polygon Amoy
- RPC: https://rpc-amoy.polygon.technology
- Chain ID: 80002
- Symbol: POL

### 4. Demo

1. Open http://localhost:3000
2. Connect MetaMask → Stake → enter 0.5 → Stake now
3. Watch execution trace go green
4. Positions → Unbond → wait 60s → Released
5. Rewards → see markers + CC estimate

## Quick restart

```bash
export PATH="/root/.dpm/bin:$PATH" && make start
cd /root/CantonStake && docker compose up -d
```

## Auth token generation (shared-secret mode)

```bash
node -e "
const crypto = require('crypto');
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify({
  sub:'ledger-api-user', iss:'canton', aud:'https://canton.network.global',
  exp: Math.floor(Date.now()/1000)+3600,
  'https://daml.com/ledger-api':{actAs:['app_provider_quickstart-root-1::1220345f9a1202551be2361e5c07312bc9ef9d0a5709116dcc051d966e4164e031b3'],readAs:['app_provider_quickstart-root-1::1220345f9a1202551be2361e5c07312bc9ef9d0a5709116dcc051d966e4164e031b3']}
})).toString('base64url');
const s = crypto.createHmac('sha256','unsafe').update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
"
```

## Troubleshooting

| Problem | Solution |
|---|---|
| LocalNet containers not healthy | `make status` — give 2-3 min, or `make stop && make start` |
| Backend UNAUTHORIZED | Need JWT token in `CANTON_AUTH_TOKEN` (see above) |
| Amoy tx "insufficient funds" | Send POL to `0xE7AE1663eAFf0E1DF071240B1c7Dc2e1Fc816729` (reward pool) |
| Amoy tx hangs | Use Alchemy/Infura RPC instead of public |
| FeaturedAppRight not found | Self-feature in wallet UI at http://wallet.localhost:2000 |
