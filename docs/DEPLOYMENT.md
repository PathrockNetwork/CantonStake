# CantonStake Deployment

This guide covers two testing targets:

- local laptop: CN Quickstart LocalNet plus the CantonStake app stack
- VPS: the app stack on a server, connected to either LocalNet on that server or a reachable DevNet/participant JSON API

Do not expose the Canton JSON API, Postgres, or Redis directly to the public internet.

## Local Testing

### 1. Start CN Quickstart LocalNet

Run CN Quickstart in a sibling directory. On Windows, WSL2/Ubuntu is the smoothest path because CN Quickstart uses `make`.

```bash
cd ../cn-quickstart/quickstart
docker login
make install-daml-sdk
make setup
make build
make start
make status
```

When `make setup` asks, use these demo-friendly choices:

- OAuth2: No
- Observability: No
- TEST MODE: No
- party hint: blank

Verify:

```bash
curl http://localhost:2975/v2/state/ledger-end
```

The Canton Coin wallet should be available at:

```text
http://wallet.localhost:2000
```

### 2. Deploy MockValidatorShare to Polygon Amoy

```bash
cd evm
cp .env.example .env
npm install
npm run compile
npm run deploy:amoy
```

Fill `DEPLOYER_PRIVATE_KEY` in `evm/.env` before deploying. Use a throwaway funded Amoy wallet.

Copy the deployed `MockValidatorShare` address.

### 3. Build and Upload the Daml DAR

Copy the Splice Featured App DAR from LocalNet, then build:

```bash
cd daml/CantonStake
mkdir -p .daml/dars
docker cp "$(docker ps -qf name=splice-app-provider):/app/dars/splice-api-featured-app-v1.dar" ./.daml/dars/
daml build
daml test
```

PowerShell equivalent for the copy step:

```powershell
cd daml\CantonStake
New-Item -ItemType Directory -Force .daml\dars
$splice = docker ps -qf "name=splice-app-provider"
docker cp "${splice}:/app/dars/splice-api-featured-app-v1.dar" .\.daml\dars\
daml build
daml test
```

Upload the generated app DAR to the app-provider participant:

```bash
docker cp ./.daml/dist/cantonstake-0.0.1.dar "$(docker ps -qf name=canton):/tmp/cantonstake-0.0.1.dar"
```

PowerShell:

```powershell
$canton = docker ps -qf "name=canton"
docker cp .\.daml\dist\cantonstake-0.0.1.dar "${canton}:/tmp/cantonstake-0.0.1.dar"
```

Open Canton Console from the `cn-quickstart/quickstart` directory in another terminal:

```bash
make canton-console
```

Inside the console:

```scala
participants.app_provider.dars.upload("/tmp/cantonstake-0.0.1.dar")

val cs = participants.app_provider.parties.enable("CantonStake")
println(s"App Provider party: ${cs.toProtoPrimitive}")

val alice = participants.app_provider.parties.enable("Alice")
println(s"Delegator party: ${alice.toProtoPrimitive}")
```

Copy both party IDs.

### 4. Self-Feature the App

Open:

```text
http://wallet.localhost:2000
```

Use the wallet self-feature flow for the CantonStake/app-provider party and copy the `FeaturedAppRight` contract ID.

### 5. Configure Root `.env`

From the repo root:

```bash
cp .env.example .env
```

Fill:

```dotenv
MOCK_VALIDATOR_SHARE_ADDRESS=0x...
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
CANTON_JSON_API_URL=http://host.docker.internal:2975
CANTON_APP_PROVIDER_PARTY=CantonStake::1220...
CANTON_DELEGATOR_PARTY=Alice::1220...
CANTON_AUTH_TOKEN=
FEATURED_APP_RIGHT_CID=00...
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
```

### 6. Start the App Stack

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

Smoke checks:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/detail
```

## VPS Testing

There are two workable VPS modes.

### Option A: VPS Runs Everything

Use this if the VPS has enough memory for CN Quickstart plus the app stack. Budget at least 8 GB RAM, preferably 10 GB.

1. Install Docker, Docker Compose, Node.js, Daml SDK/CN Quickstart prerequisites, Git, and `make`.
2. Clone `cn-quickstart` and this repo on the VPS.
3. Follow the Local Testing steps on the VPS.
4. In root `.env`, keep:

```dotenv
CANTON_JSON_API_URL=http://host.docker.internal:2975
```

5. Set the browser-visible backend URL for your VPS:

```dotenv
NEXT_PUBLIC_BACKEND_URL=http://YOUR_VPS_IP:4000
```

For a quick private test, open ports `3000` and `4000`. For anything shared, put Nginx or Caddy in front and use HTTPS.

### Option B: VPS Runs Only CantonStake

Use this if you already have DevNet or another participant JSON API reachable from the VPS.

Set:

```dotenv
CANTON_JSON_API_URL=https://YOUR_PARTICIPANT_JSON_API
CANTON_AUTH_TOKEN=YOUR_BEARER_TOKEN_IF_REQUIRED
NEXT_PUBLIC_BACKEND_URL=https://api.your-domain.example
```

Then deploy only the app stack:

```bash
docker compose up -d --build
```

The Daml package must already be uploaded to that participant, and the party IDs plus `FEATURED_APP_RIGHT_CID` must come from that same environment.

### Reverse Proxy Example

If using Nginx with two hostnames:

```nginx
server {
  server_name cantonstake.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  server_name api.cantonstake.example.com;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Then root `.env` should include:

```dotenv
NEXT_PUBLIC_BACKEND_URL=https://api.cantonstake.example.com
```

Rebuild the frontend after changing `NEXT_PUBLIC_*` values:

```bash
docker compose up -d --build frontend
```

## Reset Notes

LocalNet and DevNet resets invalidate:

- `CANTON_APP_PROVIDER_PARTY`
- `CANTON_DELEGATOR_PARTY`
- `FEATURED_APP_RIGHT_CID`
- sometimes the uploaded Daml package state

After a reset, re-upload the DAR, re-create parties, self-feature again, update `.env`, and restart:

```bash
docker compose down
docker compose up -d --build
```
