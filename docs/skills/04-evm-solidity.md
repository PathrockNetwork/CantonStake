# Skill: EVM - Solidity + Hardhat + Polygon Amoy

## When to use
Any work in `evm/`: Solidity contract logic, Hardhat config, deployment, verification, or frontend/backend integration against the mock validator-share contract.

## Key Files
- `evm/contracts/MockValidatorShare.sol` - Amoy-deployable Polygon staking mock
- `evm/scripts/deploy.ts` - deployment and reward-pool funding
- `evm/hardhat.config.ts` - compiler, networks, Etherscan config
- `evm/package.json` - scripts and tooling
- `frontend/lib/abi.ts` - frontend-facing ABI
- `backend/src/orchestrator.ts` - event consumer for `ShareMinted` and `ShareBurnedWithId`

## Actual Stack
- Solidity `0.8.24`
- Hardhat `2.22`
- `@nomicfoundation/hardhat-toolbox`
- TypeScript deploy scripts
- Hardhat-provided ethers v6 API via toolbox

This repo does not currently use OpenZeppelin contracts in `MockValidatorShare.sol`.

## Contract Model
`MockValidatorShare` is a hackathon mock of Polygon's validator-share flow:
- real native POL transactions on Amoy
- simplified 1:1 shares-to-POL accounting
- linear fixed APR rewards
- 60-second unbonding period by default
- production-like event surface for the app flow

Not production features:
- no slashing
- no commission logic
- no real StakeManager integration
- no dynamic exchange rate

## Main Contract Surface

Core functions:
- `buyVoucher(uint256 _amount, uint256 _minSharesToMint)` payable
- `sellVoucher_new(uint256 _claimAmount, uint256 _maximumSharesToBurn)`
- `unstakeClaimTokens_new(uint256 unbondNonce)`
- `withdrawRewards()`

Views:
- `balanceOf(address user)`
- `pendingRewards(address user)`
- `getUnbondNonce(address user)`
- `totalStaked()`
- `totalShares()`
- `aprBasisPoints()`
- `unbondingPeriodSeconds()`

Admin:
- `setUnbondingPeriod(uint256 secs)`
- `setAPR(uint256 bps)`

## Events
Important emitted events:
- `ShareMinted(address indexed user, uint256 amount, uint256 tokens)`
- `ShareBurnedWithId(address indexed user, uint256 amount, uint256 tokens, uint256 nonce)`
- `DelegatorUnstaked(address indexed user, uint256 amount, uint256 nonce)`
- `DelegatorClaimedRewards(address indexed user, uint256 rewards)`

The backend orchestrator currently watches:
- `ShareMinted`
- `ShareBurnedWithId`

## Deployment
Standard flow:

```bash
cd evm
npm install
npm run compile
npm run deploy:amoy
```

`deploy.ts` does three things:
1. checks deployer balance
2. deploys `MockValidatorShare`
3. funds the contract with `0.05 POL` for rewards

It requires roughly `0.1 POL` minimum and writes deployment data to:

```text
evm/deployments/amoy.json
```

## Env Notes
`evm/.env.example` currently expects:
- `AMOY_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `POLYGONSCAN_API_KEY` optional

Do not document `MOCK_VALIDATOR_SHARE_ADDRESS` as an `evm/.env` input. The deploy script outputs the address; it does not read it from `evm/.env`.

After deployment, copy the address into:
- `frontend/.env.local` as `NEXT_PUBLIC_MOCK_VALIDATOR_SHARE`
- `backend/.env` as `MOCK_VALIDATOR_SHARE_ADDRESS`
- root `.env` if using Docker Compose

## Network Notes
- network: `amoy`
- chain ID: `80002`
- default RPC: `https://rpc-amoy.polygon.technology`
- explorer: `https://amoy.polygonscan.com`
- verify script:

```bash
npm run verify:amoy -- <contract-address>
```

## Integration Notes
Frontend ABI in `frontend/lib/abi.ts` currently uses:
- `buyVoucher`
- `sellVoucher_new`
- `unstakeClaimTokens_new`
- `withdrawRewards`
- `balanceOf`
- `pendingRewards`

Current frontend writes:
- stake page: `buyVoucher(amountWei, amountWei)` with `value: amountWei`
- positions page: `sellVoucher_new(wei, wei)`

## Conventions
- native POL is sent as `msg.value`
- values are wei-based on chain
- ownership is implemented manually through `owner` and `onlyOwner`, not `Ownable`
- the contract has a payable `receive()` function so the reward pool can be funded

## Common Mistakes
- Do not describe the contract as using OpenZeppelin when it does not
- Do not document `sellVoucher(amount)`; the contract exposes `sellVoucher_new(...)`
- Do not mention `getLiquidRewards()` or `exchangeRate()`; those are not in this mock
- Do not use event names like `Staked` or `RewardsClaimed`; use the actual event names above
- Do not say the deployment address belongs in `evm/.env`
