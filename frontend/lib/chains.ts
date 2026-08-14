import type { Chain } from "viem";
import { mainnet, moonbaseAlpha, monadTestnet, polygonAmoy, sepolia } from "wagmi/chains";

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
  testnet: boolean;
  wagmiChain?: Chain;
  validatorContract?: `0x${string}`;
  explorer?: { name: string; tx: (hash: string) => string };
  /**
   * Polygon only. Staking settles on Ethereum L1, but POL balances and the
   * chain's own explorer still live on Bor. This is the Bor-side explorer so
   * the UI can link both without conflating them.
   */
  nativeExplorer?: { name: string; tx: (hash: string) => string };
};

// Validator contract resolution. Two modes:
//
//   - Real (NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true, the default for a
//     real deployment): Polygon deploys ONE ValidatorShare contract per
//     validator, created by the StakeManager when the validator registers.
//     There is therefore no deployment-wide staking address. The adapter
//     resolves the contract per validator from
//     NEXT_PUBLIC_REAL_VALIDATOR_SHARES — a JSON map of
//     "0xvalidatorSigner": "0xShareContract" — and throws if a validator has
//     no entry rather than falling back to something wrong. The backend
//     serves the same map dynamically at /api/polygon/validator-shares,
//     read straight off StakeManager.validators(id).contractAddress.
//
//   - Local fixture (flag unset/false): NEXT_PUBLIC_MOCK_VALIDATOR_SHARE
//     points at a single MockValidatorShare deployed on Amoy. That contract
//     is an E2E test fixture only — payable buyVoucher, 1:1 shares, 60 s
//     unbonding, pre-funded rewards. It is not Polygon.
const useRealValidatorShare =
  process.env.NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE === "true";

const validatorContract = process.env
  .NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}` | undefined;

let realValidatorShares: Record<string, `0x${string}`> = {};
if (useRealValidatorShare) {
  try {
    const raw = process.env.NEXT_PUBLIC_REAL_VALIDATOR_SHARES ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, `0x${string}`>;
    // Normalise keys so lookups are case-insensitive regardless of how the
    // map was generated (checksummed vs lowercase).
    realValidatorShares = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v]),
    );
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

/** Every validator signer we hold a ValidatorShare address for. */
export function knownValidatorShares(): Array<{
  validator: `0x${string}`;
  share: `0x${string}`;
}> {
  return Object.entries(realValidatorShares).map(([validator, share]) => ({
    validator: validator as `0x${string}`,
    share,
  }));
}

export const isRealValidatorShare = useRealValidatorShare;

// --- Polygon PoS settlement layer -----------------------------------------
//
// StakeManager and every ValidatorShare live on Ethereum L1 — Sepolia for
// Amoy, mainnet for Polygon mainnet. So in real mode the user signs staking
// transactions on chainId 11155111, NOT on Bor (80002), even though the token
// being staked is POL and the chain being secured is Polygon.
export const POLYGON_SETTLEMENT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID ?? "11155111",
);

export const polygonSettlementChain: Chain =
  POLYGON_SETTLEMENT_CHAIN_ID === mainnet.id ? mainnet : sepolia;

export const stakeManagerAddress = (process.env
  .NEXT_PUBLIC_POLYGON_STAKE_MANAGER ??
  "0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE") as `0x${string}`;

export const stakingLoggerAddress = (process.env
  .NEXT_PUBLIC_POLYGON_STAKING_LOGGER ??
  "0x5E3111a5d928D24718c1A7897261D0B9087002ed") as `0x${string}`;

/**
 * The ERC-20 that is actually staked, i.e. `StakeManager.token()`. On the
 * Sepolia/Amoy deployment this is POL (0x44499312…), not the legacy MATIC
 * test token. The delegator approves the StakeManager — not the
 * ValidatorShare — because StakeManager.delegationDeposit does the
 * transferFrom.
 */
export const stakeTokenAddress = (process.env.NEXT_PUBLIC_POLYGON_STAKE_TOKEN ??
  "0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa") as `0x${string}`;

/**
 * Slippage tolerance, in basis points, applied to the exchange-rate-derived
 * `_minSharesToMint` / `maximumSharesToBurn` arguments.
 */
export const SHARE_SLIPPAGE_BPS = Number(
  process.env.NEXT_PUBLIC_SHARE_SLIPPAGE_BPS ?? "50",
);

export const CHAINS: ChainConfig[] = [
  {
    id: "polygon",
    phase: "live",
    hasAdapter: true,
    symbol: "POL",
    // In real mode the wallet signs on the L1 settlement chain, so say so
    // rather than implying the transaction lands on Bor.
    name: useRealValidatorShare ? "Polygon PoS (Sepolia settlement)" : "Polygon Amoy",
    type: useRealValidatorShare ? "PoS staking on Ethereum L1" : "EVM testnet",
    apy: 8.0,
    apyRange: "4-8%",
    // 80 checkpoints is the on-chain StakeManager.withdrawalDelay(). The
    // wall-clock equivalent is not a constant — checkpoints land when
    // Heimdall proposes them — so the live ETA comes from
    // /api/polygon/staking-params, which measures the real cadence.
    unbonding: useRealValidatorShare ? "80 checkpoints" : "60s (mock fixture)",
    ledgerApp: "Ethereum",
    color: "#8247e5",
    // ValidatorShare.minAmount() is 1e18 on most validators in this
    // deployment; buyVoucher reverts below it.
    minStake: useRealValidatorShare ? 1 : 0.01,
    validators: useRealValidatorShare
      ? Object.keys(realValidatorShares).length
      : 1,
    tvl: "testnet",
    testnet: true,
    wagmiChain: useRealValidatorShare ? polygonSettlementChain : polygonAmoy,
    // Real mode has no single validator contract; resolveValidatorShare()
    // is the only correct accessor. This field stays for the fixture path.
    validatorContract: useRealValidatorShare ? undefined : validatorContract,
    explorer: useRealValidatorShare
      ? {
          name: "Etherscan (Sepolia)",
          tx: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
        }
      : {
          name: "Polygonscan",
          tx: (hash) => `https://amoy.polygonscan.com/tx/${hash}`,
        },
    nativeExplorer: {
      name: "Polygonscan (Amoy)",
      tx: (hash) => `https://amoy.polygonscan.com/tx/${hash}`,
    },
  },
  {
    id: "moonbeam",
    phase: "live",
    hasAdapter: true,
    symbol: "DEV",
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
    testnet: true,
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
    testnet: true,
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
    testnet: true,
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
    testnet: true,
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

    // Any EVM live chain with a wagmi config needs an explorer entry, plus a
    // way to name the staking contract. Polygon in real mode deliberately has
    // no single `validatorContract` — one exists per validator — so it is
    // checked against the resolver map instead.
    const hasStakingTarget =
      chain.id === "polygon" && useRealValidatorShare
        ? Object.keys(realValidatorShares).length > 0
        : Boolean(chain.validatorContract);
    if (chain.wagmiChain && (!hasStakingTarget || !chain.explorer)) {
      console.warn(
        `[chains] EVM chain ${chain.id} has wagmiChain but is missing a staking contract or explorer config`,
      );
    }

    if (chain.phase === "live" && !chain.hasAdapter) {
      console.warn(`[chains] live chain ${chain.id} is missing a chain adapter`);
    }
    if (chain.id === "polygon") {
      if (chain.phase !== "live") {
        console.warn("[chains] polygon should remain live");
      }
      if (!chain.wagmiChain || !hasStakingTarget || !chain.explorer) {
        console.warn("[chains] polygon is missing EVM staking config");
      }
      if (useRealValidatorShare && chain.wagmiChain?.id !== POLYGON_SETTLEMENT_CHAIN_ID) {
        console.warn(
          "[chains] polygon real mode must sign on the L1 settlement chain",
        );
      }
    }
    if (chain.id !== "polygon" && chain.wagmiChain) {
      console.warn(`[chains] non-polygon chain ${chain.id} unexpectedly has wagmi config`);
    }
  }
}
