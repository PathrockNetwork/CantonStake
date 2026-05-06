import type { Chain } from "viem";
import { moonbaseAlpha, monadTestnet, polygonAmoy } from "wagmi/chains";

export type ChainPhase = "live" | "planned" | "soon";

export type ChainConfig = {
  id: "polygon" | "moonbeam" | "monad" | "cosmos" | "sui";
  phase: ChainPhase;
  hasAdapter?: boolean;
  symbol: string;
  name: string;
  type: string;
  apy: number;
  apyRange: string;
  unbonding: string;
  ledgerApp: string;
  color: string;
  minStake: number;
  validators: number;
  tvl: string;
  wagmiChain?: Chain;
  validatorContract?: `0x${string}`;
  explorer?: { name: string; tx: (hash: string) => string };
};

// Validator contract resolution. Two modes:
//
//   - Demo (default): NEXT_PUBLIC_MOCK_VALIDATOR_SHARE points at a single
//     MockValidatorShare deployed on Amoy. Mirrors the production
//     ValidatorShare ABI so the staking flow is honest end-to-end against
//     a single contract.
//
//   - Real (NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true): the validator
//     contract is resolved per-validator at call time from
//     NEXT_PUBLIC_REAL_VALIDATOR_SHARES (a JSON map of "0xValidator0":
//     "0xShareContract"). Polygon's real staking model is one
//     ValidatorShare contract per validator, deployed by the StakeManager
//     when the validator is registered. The Polygon adapter checks this
//     flag and, when set, looks up the per-validator address.
//
// In demo mode the single mock address is the source of truth for every
// stake interaction. In real mode the adapter consults the map and
// throws if a validator has no entry.
const useRealValidatorShare =
  process.env.NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE === "true";

const validatorContract = process.env
  .NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}` | undefined;

let realValidatorShares: Record<string, `0x${string}`> = {};
if (useRealValidatorShare) {
  try {
    const raw = process.env.NEXT_PUBLIC_REAL_VALIDATOR_SHARES ?? "{}";
    realValidatorShares = JSON.parse(raw) as Record<string, `0x${string}`>;
  } catch (err) {
    console.warn(
      "[chains] NEXT_PUBLIC_REAL_VALIDATOR_SHARES is not valid JSON:",
      err,
    );
  }
}

export function resolveValidatorShare(
  validatorAddress: string,
): `0x${string}` | undefined {
  if (useRealValidatorShare) {
    return realValidatorShares[validatorAddress.toLowerCase()];
  }
  return validatorContract;
}

export const isRealValidatorShare = useRealValidatorShare;

export const CHAINS: ChainConfig[] = [
  {
    id: "polygon",
    phase: "live",
    hasAdapter: true,
    symbol: "POL",
    name: "Polygon Amoy",
    type: "EVM testnet",
    apy: 8.0,
    apyRange: "4-8%",
    unbonding: "21 days",
    ledgerApp: "Ethereum",
    color: "#8247e5",
    minStake: 0.01,
    validators: 5,
    tvl: "testnet",
    wagmiChain: polygonAmoy,
    validatorContract,
    explorer: {
      name: "Polygonscan",
      tx: (hash) => `https://amoy.polygonscan.com/tx/${hash}`,
    },
  },
  {
    id: "moonbeam",
    phase: "live",
    hasAdapter: true,
    symbol: "GLMR",
    name: "Moonbase Alpha",
    type: "Moonbeam testnet",
    apy: 12.0,
    apyRange: "10-15%",
    unbonding: "2 rounds (~2h)",
    ledgerApp: "Moonbeam",
    color: "#53cbc8",
    minStake: 1,
    validators: 8,
    tvl: "testnet",
    wagmiChain: moonbaseAlpha,
    // Moonbeam's parachain-staking pallet exposed at this fixed precompile
    // on every Moonbeam runtime (mainnet, Moonriver, Moonbase Alpha).
    validatorContract: "0x0000000000000000000000000000000000000800",
    explorer: {
      name: "Moonscan",
      tx: (hash) => `https://moonbase.moonscan.io/tx/${hash}`,
    },
  },
  {
    id: "monad",
    phase: "live",
    hasAdapter: true,
    symbol: "MON",
    name: "Monad Testnet",
    type: "EVM-compatible L1 testnet",
    apy: 8.0,
    apyRange: "8-12%",
    unbonding: "1 epoch",
    ledgerApp: "Ethereum",
    color: "#836ef9",
    minStake: 1,
    validators: 100,
    tvl: "testnet",
    wagmiChain: monadTestnet,
    // Monad's staking precompile lives at this fixed system address.
    validatorContract: "0x0000000000000000000000000000000000001000",
    explorer: {
      name: "Monad Explorer",
      tx: (hash) => `https://testnet.monadexplorer.com/tx/${hash}`,
    },
  },
  {
    id: "cosmos",
    phase: "live",
    hasAdapter: true,
    symbol: "ATOM",
    name: "Cosmos Hub Theta",
    type: "Cosmos Hub testnet",
    apy: 21.0,
    apyRange: "17-22%",
    unbonding: "1 day",
    ledgerApp: "Cosmos",
    color: "#6f7390",
    minStake: 1,
    validators: 50,
    tvl: "testnet",
  },
  {
    id: "sui",
    phase: "live",
    hasAdapter: true,
    symbol: "SUI",
    name: "Sui Testnet",
    type: "Move-based L1 testnet",
    apy: 3.5,
    apyRange: "3-4%",
    unbonding: "1 epoch (~24h)",
    ledgerApp: "Sui",
    color: "#4ca2ff",
    minStake: 1,
    validators: 100,
    tvl: "testnet",
  },
];

export const liveChains = () => CHAINS.filter((chain) => chain.phase === "live");
export const chainById = (id: string) => CHAINS.find((chain) => chain.id === id);
export const polygonChain = () => chainById("polygon")!;

/**
 * Best-effort chain detection from a stake's `evmAddress` field. The
 * Daml StakingPosition template doesn't yet carry an explicit `chain`
 * field (would require a DAR redeploy), so we infer from the address
 * format:
 *
 *   - bech32 starting with `cosmos1`        → Cosmos Hub theta-testnet
 *   - 0x followed by 64 hex chars           → Sui (32-byte address)
 *   - 0x followed by 40 hex chars           → an EVM chain. Defaults to
 *     "polygon" since we can't disambiguate Polygon vs Moonbeam vs Monad
 *     from the address alone. Pass `evmHint` (e.g. the chain saved in
 *     localStorage at stake time) to override.
 */
export function chainFromAddress(
  address: string | undefined | null,
  evmHint?: ChainConfig["id"],
): ChainConfig {
  if (!address) return polygonChain();
  if (address.startsWith("cosmos1")) return chainById("cosmos") ?? polygonChain();
  if (/^0x[a-fA-F0-9]{64}$/.test(address))
    return chainById("sui") ?? polygonChain();
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    if (evmHint) return chainById(evmHint) ?? polygonChain();
    return polygonChain();
  }
  return polygonChain();
}

if (process.env.NODE_ENV !== "production") {
  const ids = new Set<string>();

  if (polygonChain().id !== "polygon") {
    console.warn("[chains] polygonChain() did not resolve to polygon");
  }

  for (const chain of CHAINS) {
    if (ids.has(chain.id)) console.warn(`[chains] duplicate chain id ${chain.id}`);
    ids.add(chain.id);

    // Any EVM live chain with a wagmi config also needs a validator
    // contract address + an explorer entry so the stake page can build a
    // tx, switch the chain, and link the receipt out.
    if (chain.wagmiChain && (!chain.validatorContract || !chain.explorer)) {
      console.warn(
        `[chains] EVM chain ${chain.id} has wagmiChain but is missing validatorContract or explorer config`,
      );
    }

    if (chain.phase === "live" && !chain.hasAdapter) {
      console.warn(`[chains] live chain ${chain.id} is missing a chain adapter`);
    }
    if (chain.id === "polygon") {
      if (chain.phase !== "live") {
        console.warn("[chains] polygon should remain live");
      }
      if (!chain.wagmiChain || !chain.validatorContract || !chain.explorer) {
        console.warn("[chains] polygon is missing EVM staking config");
      }
    }
    if (chain.id !== "polygon" && chain.wagmiChain) {
      console.warn(`[chains] non-polygon chain ${chain.id} unexpectedly has wagmi config`);
    }
  }
}
