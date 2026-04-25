# Skill: Frontend - Next.js 14 + wagmi v2 + Tailwind

## When to use
Any work in `frontend/`: route pages, wallet UX, API calls, layout, styling, or env-driven frontend behavior.

## Key Files
- `frontend/app/layout.tsx` - root layout shell
- `frontend/app/providers.tsx` - `WagmiProvider` + `QueryClientProvider`
- `frontend/app/page.tsx` - landing page and lifecycle overview
- `frontend/app/stake/page.tsx` - core staking flow
- `frontend/app/positions/page.tsx` - active position table and unbond action
- `frontend/app/rewards/page.tsx` - marker and reward dashboard
- `frontend/components/TopNav.tsx` - nav and wallet connector picker
- `frontend/lib/wagmi.ts` - Amoy chain config and connectors
- `frontend/lib/api.ts` - backend API wrapper
- `frontend/lib/abi.ts` - `MockValidatorShare` ABI
- `frontend/lib/loop-wallet.ts` - mock Canton wallet helper, currently not wired into the main flow
- `frontend/app/globals.css` - global styles and utility classes
- `frontend/tailwind.config.ts` - colors, fonts, and `text-xxs`

## Actual Stack
- Next.js 14 App Router
- React 18 client components where needed
- wagmi v2
- `@tanstack/react-query`
- viem
- Tailwind CSS 3
- WalletConnect connector is optional and only appears when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set

## Wallet Model In This Repo
- The active app flow is EVM-wallet first
- `TopNav` uses wagmi connectors for:
  - injected browser wallets
  - WalletConnect when configured
- The staking page currently uses `NEXT_PUBLIC_CANTON_DELEGATOR_PARTY` from env for the Canton delegator identity
- `frontend/lib/loop-wallet.ts` exists as a mock/future adapter, but it is not currently used by `stake`, `positions`, `rewards`, or `TopNav`

Do not assume the current UI has a real Canton wallet session.

## Wagmi Notes
`frontend/lib/wagmi.ts` configures:

```ts
chains: [polygonAmoy]
connectors: [injected(), walletConnect(...) if projectId exists]
ssr: true
```

Current behavior:
- wrong-network checks use `polygonAmoy.id`
- WalletConnect metadata is hardcoded for CantonStake
- no custom transport logic beyond default `http()`

## Current Page Patterns
- `stake/page.tsx`
  - creates the Canton `StakingRequest` first through the backend
  - then sends `buyVoucher()` on Amoy
  - shows a four-step execution trace
- `positions/page.tsx`
  - polls backend positions every 5s
  - calls `sellVoucher_new()` on the contract for bonded positions
- `rewards/page.tsx`
  - polls backend rewards and positions every 10s
  - presents marker counts and an illustrative CC estimate

## API Usage
All app API calls go through `frontend/lib/api.ts`.

Environment default:

```ts
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
```

Main functions:
- `createStakingRequest(...)`
- `fetchPositions(address)`
- `fetchPendingRequests(address)`
- `fetchRewards(address)`

## Styling Notes
Theme comes from `frontend/tailwind.config.ts` and `frontend/app/globals.css`.

Important custom tokens:
- colors:
  - `ink.*`
  - `amber`, `amber.bright`, `amber.glow`
  - `success`, `warning`, `danger`
- fonts:
  - `font-display` = Instrument Serif
  - `font-mono` = JetBrains Mono
- size:
  - `text-xxs`

Important utility classes:
- `hairline`
- `hairline-b`
- `hairline-t`
- `hairline-r`
- `chip`
- `chip-dot`
- `tabular`

## Environment Variables
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_MOCK_VALIDATOR_SHARE`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_CANTON_DELEGATOR_PARTY`

Use `frontend/.env.local`, not `frontend/.envlocal`.

## Conventions
- Add `"use client"` to components that use hooks or browser APIs
- Prefer `frontend/lib/api.ts` instead of inlining fetch logic
- Keep chain-specific assumptions tied to `polygonAmoy`
- Treat `NEXT_PUBLIC_CANTON_DELEGATOR_PARTY` as the current delegator source unless you are explicitly wiring in `useLoopWallet`
- Use the ABI from `frontend/lib/abi.ts`, not copied snippets

## Canton Wallet Integration (Future Path)
The current Canton identity is a static env var. For production, consider these integration paths:

### splice-wallet-kernel (dApp Development Kit)
Hyperledger Labs dApp Development Kit for Canton — provides wallet kernel for browser dApps:
- `https://github.com/hyperledger-labs/splice-wallet-kernel`

### dApp API + SDK
OpenRPC spec and SDK for dApp-side integration with Canton wallets:
- OpenRPC spec: `openrpc-dapp-api.json` (in splice-wallet-kernel repo)
- dApp SDK: available in the splice-wallet-kernel monorepo

### Five North ID SDK
Identity verification SDK — relevant for KYC/identity flows tied to Canton parties:
- `https://docs.fivenorth.io/id-sdk`

### Canton Ecosystem Wallets
Overview of all available wallets on Canton network for integration reference:
- `https://cantonecosystem.com`

### Build on Canton MCP
Local MCP plugin for Claude AI — curated knowledge base covering Canton's dev stack:
- `https://github.com/Jatinp26/Build-on-Canton-MCP`

## Common Mistakes
- Do not assume Loop mock wallet is live in the app flow
- Do not reference a `WagmiProvider` directly in `layout.tsx`; it is wrapped via `Providers`
- Do not use `balancesOf`; the ABI exposes `balanceOf`
- Do not describe the frontend as MetaMask-only; WalletConnect support exists when configured
- Do not forget the staking flow currently creates the Canton request before submitting the EVM tx
