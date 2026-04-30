# CantonStake — Full Deploy Tutorial

End-to-end instructions to get CantonStake running locally, from zero to a working demo with real Polygon Amoy transactions and on-ledger FeaturedAppActivityMarkers.

**Estimated time:** 3–4 hours for the first run. 15 minutes to restart a clean environment afterwards.

---

## 0. Prerequisites

Before you start, make sure you have:

- **Docker Desktop** with at least 8 GB memory allocated (CN Quickstart needs it). Open Docker Desktop → Settings → Resources and set Memory to 8 GB.
- **Node.js 20+** and **npm**
- **Git**
- **MetaMask** browser extension (or any WalletConnect-compatible wallet)
- **Access to the CN Quickstart GitHub repo.** If you get 404s, email Digital Asset — access is gated and requires a sponsoring Super Validator contact.
- **A throwaway Ethereum wallet** with a few 0.1+ POL on Amoy. Get testnet POL from https://faucets.chain.link/polygon-amoy or the Polygon Discord faucet bot. **Do not use a wallet that holds real funds.**

Check them:

```bash
docker --version           # 20.x or higher
docker compose version     # v2
node --version             # v20.x
npm --version
git --version
```

---

## 1. Clone and prepare the workspace

Pick a parent directory. We'll put `cn-quickstart` and `cantonstake` as siblings.

```bash
mkdir ~/canton-work && cd ~/canton-work
git clone https://github.com/digital-asset/cn-quickstart.git
# Then drop the cantonstake/ directory here (extract the zip/tar you received)
ls
# cn-quickstart  cantonstake
```

---

## 2. Start CN Quickstart LocalNet

This gets you a full local Canton network: an App Provider participant, an App User participant, a Super Validator (synchronizer), a Canton Coin wallet, and the Splice support services.

```bash
cd ~/canton-work/cn-quickstart/quickstart
direnv allow                     # If you use direnv; otherwise skip
docker login                     # Required for Digital Asset artifact access
make install-daml-sdk            # Slow — installs Daml SDK. 5–10 minutes.
make setup
```

When `make setup` prompts:

- **Enable OAuth2:** No (simpler for the hackathon; you can turn on later)
- **Enable Observability:** No (saves RAM)
- **Enable TEST MODE:** No
- **Party hint:** leave blank (uses default)

Then:

```bash
make build                       # 3–5 minutes
make start                       # Starts all the containers. 2–3 minutes until everything is green.
```

In a second terminal, watch the logs:

```bash
cd ~/canton-work/cn-quickstart/quickstart
make capture-logs
# ctrl-c to stop — logs are in quickstart/logs/
```

Verify it's up:

```bash
make status
# All services should be "Up" and "healthy"
```

Also open these in your browser:

- http://wallet.localhost:2000 — the Canton Coin wallet (for self-featuring later)
- http://localhost:2975/v2/state/ledger-end — the JSON Ledger API health check for the App Provider. You should see JSON back.
- The licensing demo at http://localhost:3000 proves the full stack is wired up. (We will replace this UI with CantonStake's later, so stop the demo frontend before running ours: `docker stop quickstart-frontend-1` — name may differ; check with `docker ps`.)

> **Memory tip:** If containers flake out, bump Docker Desktop memory to 10 GB and run `make clean-all` then start over.

---

## 3. Deploy MockValidatorShare to Polygon Amoy

This is the EVM side — a real on-chain contract on a real testnet.

### 3a. Fund your deployer wallet

Go to https://faucets.chain.link/polygon-amoy, connect the throwaway wallet, claim 0.01 POL. Repeat a few times if needed — you want about 0.1 POL total for deploying + funding the reward pool.

### 3b. Configure the deploy

```bash
cd ~/canton-work/cantonstake/evm
cp .env.example .env
# Edit .env — paste your deployer private key:
# DEPLOYER_PRIVATE_KEY=0xabc123...
# (Optional) POLYGONSCAN_API_KEY=... for verification later
```

### 3c. Install and deploy

```bash
npm install
npm run compile
npm run deploy:amoy
```

You should see:

```
Deploying with: 0xYourWallet
Balance: 0.15 POL

1. Deploying MockValidatorShare...
   MockValidatorShare deployed at: 0xABCDEF1234...

2. Funding reward pool (0.05 POL)...
   Funded: 0xTransactionHash

3. Done. Verify with:
   npm run verify:amoy:deployed
```

**Copy the `MockValidatorShare deployed at:` address.** You'll need it in three places:

- `backend/.env` as `MOCK_VALIDATOR_SHARE_ADDRESS`
- `frontend/.env.local` as `NEXT_PUBLIC_MOCK_VALIDATOR_SHARE`
- Root `.env` (for docker compose) as `MOCK_VALIDATOR_SHARE_ADDRESS`

### 3d. (Optional) Verify on Polygonscan

```bash
npm run verify:amoy:deployed
# or: npm run verify:amoy -- 0xABCDEF1234...
```

If the contract needs more mock reward liquidity later:

```bash
FUND_AMOUNT_POL=0.05 npm run fund:amoy
```

### 3e. Sanity-check on Amoy Polygonscan

Open `https://amoy.polygonscan.com/address/0xABCDEF1234...` — you should see the contract creation transaction and the 0.05 POL balance.

---

## 4. Build and upload the Daml package

### 4a. Get the Splice Featured App DAR

The Daml contracts depend on `splice-api-featured-app-v1.dar` to create FeaturedAppActivityMarker contracts. LocalNet bundles it, but we need to copy it into our package's dependencies folder.

```bash
cd ~/canton-work/cantonstake/daml/CantonStake
mkdir -p .daml/dars

# LocalNet stores Splice DARs inside its splice container.
# Copy the one we need out:
docker cp $(docker ps -qf "name=splice-app-provider"):/app/dars/splice-api-featured-app-v1.dar ./.daml/dars/

# Verify:
ls -la .daml/dars/
# splice-api-featured-app-v1.dar
```

If the container name differs, find it with `docker ps | grep splice` and adjust the cp command. If the file is in a different path inside the container, try `/app/resources/dars/` or `daml/dars/`.

### 4b. Build the package

```bash
daml build
# Builds .daml/dist/cantonstake-0.0.1.dar
```

### 4c. Run tests

```bash
daml test
# Should pass: testHappyPath, testCannotUnbondFromPending
```

If tests fail, the state machine logic has a regression — fix before moving on.

### 4d. Upload the DAR to LocalNet's App Provider participant

In a new terminal, open the Canton Console:

```bash
cd ~/canton-work/cn-quickstart/quickstart
make canton-console
```

Inside the console:

```scala
val darPath = "/shared/cantonstake-0.0.1.dar"
participants.app_provider.dars.upload(darPath)
```

You'll need to make the DAR available to the container first. The simplest way:

```bash
# From outside Canton Console, in a new terminal:
docker cp ~/canton-work/cantonstake/daml/CantonStake/.daml/dist/cantonstake-0.0.1.dar \
  $(docker ps -qf "name=canton"):/tmp/cantonstake-0.0.1.dar
```

Then in Canton Console:

```scala
participants.app_provider.dars.upload("/tmp/cantonstake-0.0.1.dar")
```

### 4e. Allocate the CantonStake party

Still in Canton Console:

```scala
val csHint = "CantonStake"
val cs = participants.app_provider.parties.enable(csHint)
println(s"App Provider party: ${cs.toProtoPrimitive}")

val aliceHint = "Alice"
val alice = participants.app_provider.parties.enable(aliceHint)
println(s"Delegator party: ${alice.toProtoPrimitive}")
```

**Copy both party IDs.** You'll paste them into the env files. They look like `CantonStake::1220a0db3761...`.

### 4f. Find the exact package id for the backend template references

```bash
daml damlc inspect-dar ~/canton-work/cantonstake/daml/CantonStake/.daml/dist/cantonstake-0.0.1.dar | head -10
```

You'll see something like:

```
DAR archive contains the following packages:

cantonstake-0.0.1-a1b2c3d4... "a1b2c3d4..."
```

The hash after the version is your package id. Update `backend/src/canton.ts`:

```typescript
export const TEMPLATES = {
  StakingRequest: "a1b2c3d4...:CantonStake.Staking:StakingRequest",
  StakingPosition: "a1b2c3d4...:CantonStake.Staking:StakingPosition",
} as const;
```

(Alternatively, keep the `#cantonstake:` prefix which uses package name resolution — works if you have only one version of the package uploaded.)

---

## 5. Self-feature the CantonStake party

On LocalNet you can self-feature — no governance vote required. This gives your app party a `FeaturedAppRight` contract, which is what lets `FeaturedAppActivityMarker` actually convert into `AppRewardCoupon`.

### 5a. Open the Canton Coin wallet

Go to **http://wallet.localhost:2000**

Log in as `CantonStake` (the party you allocated). If prompted to tap for CC, do so — you'll need a small balance.

### 5b. Self-feature

Look for a "Self-feature" or "Request Featured Status" option in the wallet UI. Tap it.

> **If the option is missing:** the wallet version may differ. The alternative is to create the `FeaturedAppRight` contract directly via the Canton Console:
>
> ```scala
> // In Canton Console, as the DSO party
> // (see https://docs.sync.global/app_dev/daml_api/index.html for the full flow)
> ```
>
> Or via a direct gRPC/JSON call. See the [Featured App How-To](https://docs.global.canton.network.sync.global/background/tokenomics/feat_app_act_marker_tokenomics.html) for details.

### 5c. Copy the FeaturedAppRight contract id

After self-featuring, the wallet UI shows the new `FeaturedAppRight` contract. Copy its contract id (starts with `00...`). This goes into `backend/.env` as `FEATURED_APP_RIGHT_CID`.

Alternatively query it from Canton Console:

```scala
participants.app_provider.ledger_api.state.acs.of_party(cs)
  .filter(_.templateId.contains("FeaturedAppRight"))
  .foreach(c => println(c.contractId.coid))
```

---

## 6. Configure the backend

```bash
cd ~/canton-work/cantonstake/backend
cp .env.example .env
```

Edit `.env`:

```
PORT=4000
LOG_LEVEL=info

AMOY_RPC_URL=https://rpc-amoy.polygon.technology
MOCK_VALIDATOR_SHARE_ADDRESS=0xABCDEF1234...         # From step 3c

CANTON_JSON_API_URL=http://localhost:2975            # LocalNet App Provider
CANTON_APP_PROVIDER_PARTY=CantonStake::1220a0db...   # From step 4e
CANTON_AUTH_TOKEN=                                    # Empty — OAuth disabled

FEATURED_APP_RIGHT_CID=00abc123...                   # From step 5c
DEMO_MODE=true                                       # Enables manual reward round trigger
```

Test it:

```bash
npm install
npm run dev
```

You should see:

```
[orchestrator] watching 0xABCDEF1234... on Amoy
cantonstake backend listening on :4000
orchestrator running
```

Ping the health endpoint:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","cantonJsonApi":"...","validatorShare":"...","featuredAppRight":"configured","time":"..."}
```

If `featuredAppRight` says `missing`, revisit step 5. If there are 500 errors about the JSON API, check your `CANTON_APP_PROVIDER_PARTY` and that LocalNet is still running.

---

## 7. Configure and run the frontend

```bash
cd ~/canton-work/cantonstake/frontend
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_MOCK_VALIDATOR_SHARE=0xABCDEF1234...     # From step 3c
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=                # Optional
NEXT_PUBLIC_MOCK_LOOP_PARTY_ID=Alice::1220...        # Hosted delegator party for mock Loop
```

Install and run:

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. You should see the landing page.

---

## 8. Add Amoy to MetaMask

In MetaMask:

- Networks → Add network → Add network manually
- Name: **Polygon Amoy**
- RPC URL: `https://rpc-amoy.polygon.technology`
- Chain ID: `80002`
- Currency Symbol: `POL`
- Block Explorer: `https://amoy.polygonscan.com`

Make sure the wallet you use for staking is funded with ~0.1 POL from the faucet. **Use the same wallet you're tracking as `Alice` on the Canton side conceptually** — in this MVP the mapping is just by EVM address, not cryptographic identity.

---

## 9. Run the full demo

1. Open http://localhost:3000
2. Connect MetaMask (Amoy)
3. Go to **Stake** → enter `0.5`, click **Stake now**
4. Watch the execution trace:
   - **01** Create StakingRequest → done (green dot)
   - **02** buyVoucher → MetaMask popup → sign → running → done
   - **03** Orchestrator catches ShareMinted → running (backend terminal shows `[ShareMinted] user=0x... tx=0x...`)
   - **04** StakingRequest_Accept → done (backend terminal shows `-> accepted. tx=...`)
5. Go to **Positions** → table shows one **Bonded** row, markers: 1
6. Click **Unbond** → MetaMask popup → sign → after confirmation, row becomes **Unbonding**, markers: 2, `ready at` shows ~60 seconds from now
7. Wait 60–75 seconds (backend release checker runs every 15s). Row becomes **Released**.
8. Go to **Rewards** → markers emitted: 2, bonded POL: 0 (position released), estimated CC: shown

If all five trace rows go green without manual intervention, the demo works end-to-end.

---

## 10. (Optional) Inspect on Canton directly

In a new terminal:

```bash
cd ~/canton-work/cn-quickstart/quickstart
make shell   # Opens Daml Shell
```

Inside Daml Shell:

```
active CantonStake.Staking:StakingPosition
active Splice.Api.FeaturedAppRightV1:FeaturedAppActivityMarker
```

You'll see your actual contracts, the markers that were emitted, and the beneficiary splits — all on the ledger.

---

## Troubleshooting

### `make start` fails with memory errors
Allocate 10 GB to Docker Desktop. Run `make clean-all`, then `make start`.

### Backend says `Canton exercise failed: UNAUTHORIZED`
OAuth is enabled on LocalNet but you set `CANTON_AUTH_TOKEN=`. Either disable OAuth at `make setup` time (redo setup), or get a bearer token from the Keycloak admin UI at http://localhost:8080.

### `ShareMinted` fires but backend says "no matching pending StakingRequest"
Your delegator EVM address on the frontend doesn't match the MetaMask account that signed. Or the amount is different (e.g. `0.5` vs `0.50`). The matcher compares exact decimal strings. Normalize on the frontend side to `parseFloat(amount).toString()` if needed.

### Markers are created but no AppRewardCoupons appear
The `FeaturedAppRight` contract isn't active, or its provider party doesn't match the `appProvider` party on the StakingPosition. Double-check you self-featured the **same** party you're using as `CANTON_APP_PROVIDER_PARTY`.

### Amoy transactions fail with "insufficient funds"
The reward pool in `MockValidatorShare` is low. Send more POL to the contract address (it has a `receive()` function).

### Amoy transactions hang forever
Public Amoy RPCs rate-limit. Get a free dedicated RPC from Alchemy, Infura, or QuickNode and replace `AMOY_RPC_URL` in both `evm/.env` and `backend/.env`.

### Daml build fails with "cannot find splice-api-featured-app-v1.dar"
Step 4a didn't copy the DAR. Check the running Splice container:

```bash
docker ps | grep splice
docker exec -it <splice-container-name> ls /app/dars
```

Adjust the `docker cp` command to the correct path.

### `daml test` passes but frontend exercise fails
Template ID mismatch. Rerun `daml damlc inspect-dar` and update `backend/src/canton.ts` `TEMPLATES` with the actual package id.

---

## Cleanup

```bash
# Stop CantonStake
cd ~/canton-work/cantonstake
docker compose down

# Stop LocalNet
cd ~/canton-work/cn-quickstart/quickstart
make stop
# Full reset:
make clean-all
```

---

## What to demo at the hackathon

The 3-minute script in the README is the sharp version. The full 10-minute walkthrough adds:

- Show the Daml source code on Staking.daml — point at the marker emission and the beneficiary split. "This is the entire trust story. Four lines of Daml."
- Show `backend/src/orchestrator.ts` — point at the viem event watcher. "73 lines of TypeScript. The orchestrator is minimal on purpose."
- Show `MockValidatorShare.sol` — point at the event signatures. "Matches Polygon's real interface. This flow is a drop-in swap for mainnet on Ethereum."
- In Daml Shell: `active Splice.Api.FeaturedAppRightV1:FeaturedAppActivityMarker` — "these are real ledger contracts. Super Validator automation converts them into reward coupons."

---

## What to build next (post-hackathon roadmap)

- **Replace MockValidatorShare with real mainnet integration.** Deploy the frontend + backend against Ethereum mainnet where Polygon's real `StakeManager` and `ValidatorShare` contracts live.
- **Loop SDK integration for wallet-level party management.** Once Loop supports custom DAR (or as a pure CC wallet connector for the rewards page only).
- **Multi-chain support.** Cosmos (ATOM), Polkadot (DOT), Moonbeam (GLMR). Each adds a new backend connector but reuses the same Daml state machine.
- **Featured App mainnet application.** Submit via https://canton.foundation/featured-app-request/ — takes weeks of 2/3 Super Validator vote but converts the DevNet demo into real CC revenue.
- **Auto-compound premium tier.** Daml choice that reinvests claimed rewards into a new StakingPosition, emitting an additional marker.
- **Ledger hardware support.** Add `@ledgerhq/connect-kit` as a wagmi connector.
