# Skill: Hackathon Guide — Judging Criteria & Pitch Prep

## When to use
When preparing demos, pitch materials, or ensuring the project meets hackathon judging criteria.

## Judging Criteria Checklist

### 1. MVP Materials
- [ ] Working prototype (stake → unbond → rewards flow)
- [ ] Live demo on Polygon Amoy + Canton LocalNet
- [ ] Product mockups / UI screenshots
- [ ] Public GitHub repo with README
- [ ] Quick-start instructions (TUTORIAL.md)

### 2. Go-To-Market Strategy
- [ ] Target distribution channels
- [ ] Market positioning (cross-chain staking + Canton Coin rewards)
- [ ] User acquisition hypotheses
- [ ] Competitive analysis vs. traditional staking platforms

### 3. ICP / Target Audience
- [ ] Clear description of target user (POL holders seeking yield diversification)
- [ ] Specific pain point addressed (limited cross-chain reward opportunities)
- [ ] User persona definition

### 4. Value / Problem Statement
- [ ] What problem is solved (bridge between EVM staking and Canton Coin economy)
- [ ] Why it matters (first Featured App bridging Polygon ↔ Canton)
- [ ] Why now (Canton Network launch, CC burn-mint equilibrium live)

### 5. Metrics / Validation
- [ ] User interviews or feedback notes
- [ ] Test transactions on Amoy testnet
- [ ] Smart contract verification on Polygonscan
- [ ] CC reward round execution logs
- [ ] Success criteria definition

### 6. Pitch Materials
- [ ] Clear problem → solution → "why us" narrative
- [ ] Architecture diagram (see skill 05)
- [ ] Demo video or live walkthrough
- [ ] Team credentials and track record

## Demo Script

### Setup (5 min before demo)
1. Start Canton LocalNet (`make start`)
2. Start docker-compose (`docker compose up`)
3. Deploy MockValidatorShare to Amoy if not already deployed
4. Fund demo wallet with Amoy POL from faucet
5. Verify `/api/health/detail` returns all services connected

### Live Demo Flow (3-5 min)
1. **Connect wallet** — Show MetaMask connection + Canton party ID
2. **Stake POL** — Enter amount → confirm EVM tx → show StakingRequest on Canton
3. **Show position** — Bonded StakingPosition with marker emitted
4. **Unbond** — Trigger unbond → show Unbonding state
5. **Rewards** — Show CC reward dashboard with earned estimates
6. **Architecture** — Brief slide showing cross-chain flow

### Key Talking Points
- **Cross-chain**: First app bridging Polygon EVM staking with Canton Coin rewards
- **Real smart contracts**: Working Daml templates + Solidity contracts, not just mockups
- **CC Economics**: 75/25 beneficiary split via FeaturedAppActivityMarker (CIP-47)
- **Hardware wallet support**: Ledger via WalletConnect for secure staking
- **Automated rewards**: 10-minute CC reward rounds via BullMQ

## Repo Presentation Checklist
- [ ] README.md is clear and complete
- [ ] TUTORIAL.md has step-by-step setup
- [ ] `.env.example` files are up to date
- [ ] No sensitive data in git history
- [ ] Smart contract verified on Polygonscan
- [ ] Docker compose starts all services cleanly

## CantonStake Value Proposition (Elevator Pitch)

> CantonStake is the first cross-chain staking platform bridging Polygon EVM with the Canton Network.
> Users stake POL on Polygon Amoy and earn Canton Coin (CC) rewards through Featured App activity markers.
> Built with Daml smart contracts on Canton, Solidity on Polygon, and a Fastify/Next.js full stack —
> it demonstrates real cross-chain composability with privacy-preserving smart contracts.

## Featured App Readiness
To be recognized as a Featured App on Canton Network:
1. ✅ Running Canton node (LocalNet / DevNet)
2. ✅ Active on-chain activity (staking/unbonding transactions)
3. ✅ Activity markers emitted (FeaturedAppActivityMarker on bond/unbond)
4. ✅ 1.15 marker-to-gas ratio rule followed
5. ⬜ Submit Featured App request to GSF Tokenomics Committee (post-hackathon)