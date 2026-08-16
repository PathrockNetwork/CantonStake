import type { Chain } from "viem";
import { bscTestnet, mainnet, monadTestnet, polygonAmoy, sepolia } from "wagmi/chains";

export type ChainPhase = "live" | "planned" | "soon";

export type ChainConfig = {
  id:
    | "polygon"
    | "monad"
    | "cosmos"
    | "celestia"
    | "osmosis"
    | "sui"
    | "aptos"
    | "polkadot"
    | "bnb"
    | "solana";
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

// The baked NEXT_PUBLIC_REAL_VALIDATOR_SHARES map is a snapshot from build
// time (and a *testnet* one at that). Before any mainnet-mode delegation,
// the live registry is fetched from the backend, which resolves every
// ValidatorShare from the settlement chain's StakeManager at runtime. The
// same response carries each validator's buyVoucher floor, so one fetch
// fills both the share registry and the minimums.
let liveSharesPromise: Promise<void> | null = null;

/** Per-validator buyVoucher floor (wei), keyed by validator signer. */
export const validatorMinAmounts = new Map<string, bigint>();

export function ensureValidatorSharesLive(): Promise<void> {
  if (!useRealValidatorShare || liveSharesPromise) return liveSharesPromise ?? Promise.resolve();
  liveSharesPromise = (async () => {
    try {
      const backend =
        process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";
      const res = await fetch(`${backend}/api/polygon/validator-shares`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        map?: Record<string, string>;
        validators?: Array<{ signer?: string; minAmount?: string }>;
      };
      for (const [signer, share] of Object.entries(body.map ?? {})) {
        realValidatorShares[signer.toLowerCase()] = share as `0x${string}`;
      }
      for (const v of body.validators ?? []) {
        // A zero floor means the deployment has no per-validator minimum —
        // leave it out so callers fall back to the chain-level minStake.
        if (v.signer && v.minAmount && v.minAmount !== "0") {
          validatorMinAmounts.set(v.signer.toLowerCase(), BigInt(v.minAmount));
        }
      }
    } catch (err) {
      // Registry stays at the baked snapshot; contractAddress() still
      // hard-errors on unknown validators rather than guessing. Minimums
      // stay empty — they are advisory, the chain enforces the real floor.
      console.warn("[chains] live validator-share fetch failed:", err);
    }
  })();
  return liveSharesPromise;
}

/** Await the per-validator buyVoucher floors (same fetch as the shares). */
export async function ensureValidatorMinimums(): Promise<void> {
  await ensureValidatorSharesLive();
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
  process.env.NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID ??
    (process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet" ? "1" : "11155111"),
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
    id: "celestia",
    phase: "live",
    // Watcher live (Cosmos-shape tx_search on mocha); staking UI pending
    // the Keplr suggest-chain flow.
    hasAdapter: false,
    symbol: "TIA",
    name: "Celestia Mocha",
    type: "Cosmos SDK data-availability testnet",
    apy: 10.0,
    apyRange: "9-12%",
    unbonding: "21 days",
    ledgerApp: "Cosmos",
    color: "#7b2bf9",
    minStake: 1,
    validators: 60,
    tvl: "testnet",
    testnet: true,
  },
  {
    id: "osmosis",
    phase: "live",
    hasAdapter: false,
    symbol: "OSMO",
    name: "Osmosis Testnet",
    type: "Cosmos SDK DeFi testnet",
    apy: 12.0,
    apyRange: "10-14%",
    unbonding: "14 days",
    ledgerApp: "Cosmos",
    color: "#6f4fe0",
    minStake: 1,
    validators: 80,
    tvl: "testnet",
    testnet: true,
  },
  {
    id: "aptos",
    phase: "live",
    hasAdapter: false,
    symbol: "APT",
    name: "Aptos Testnet",
    type: "Move-based L1 testnet",
    apy: 7.0,
    apyRange: "6-8%",
    unbonding: "~14 days (unlock + withdraw phases)",
    ledgerApp: "Aptos",
    color: "#1a1a1a",
    minStake: 1,
    validators: 60,
    tvl: "testnet",
    testnet: true,
  },
  {
    id: "polkadot",
    phase: "live",
    hasAdapter: false,
    symbol: "WND",
    name: "Polkadot Westend",
    type: "Substrate nominator testnet",
    apy: 12.0,
    apyRange: "10-14%",
    unbonding: "28 days",
    ledgerApp: "Polkadot",
    color: "#e6007a",
    minStake: 0.01,
    validators: 100,
    tvl: "testnet",
    testnet: true,
  },
  {
    id: "bnb",
    phase: "live",
    // Watcher live (StakeHub Delegated logs on Chapel); staking UI needs
    // the payable delegate() flow.
    hasAdapter: false,
    symbol: "tBNB",
    name: "BNB Chain Chapel",
    type: "PoSA EVM testnet",
    apy: 5.0,
    apyRange: "4-6%",
    unbonding: "7 days",
    ledgerApp: "Ethereum",
    color: "#f0b90b",
    minStake: 0.01,
    validators: 45,
    tvl: "testnet",
    testnet: true,
    wagmiChain: bscTestnet,
    validatorContract: "0x0000000000000000000000000000000000002002",
    explorer: {
      name: "BscScan (Chapel)",
      tx: (hash) => `https://testnet.bscscan.com/tx/${hash}`,
    },
  },
  {
    id: "solana",
    phase: "live",
    hasAdapter: false,
    symbol: "SOL",
    name: "Solana Testnet",
    type: "Stake-account PoS testnet",
    apy: 7.0,
    apyRange: "6-8%",
    unbonding: "~2 days (epoch boundary)",
    ledgerApp: "Solana",
    color: "#14f195",
    minStake: 0.01,
    validators: 200,
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

// --- Mainnet display overrides ---------------------------------------------
//
// In mainnet mode the same chain entries serve production names, explorers
// and the real-minimum context. Faucet-style funding hints are suppressed
// by the stake page (there are no mainnet faucets — real funds only).

import { isMainnet } from "@/lib/network";

if (isMainnet) {
  for (const c of CHAINS) {
    c.testnet = false;
    c.tvl = "mainnet";
  }
  const mainnetName: Partial<Record<ChainConfig["id"], string>> = {
    polygon: "Polygon PoS",
    monad: "Monad",
    cosmos: "Cosmos Hub",
    celestia: "Celestia",
    osmosis: "Osmosis",
    sui: "Sui",
    aptos: "Aptos",
    polkadot: "Polkadot",
    bnb: "BNB Chain",
    solana: "Solana",
  };
  for (const c of CHAINS) {
    const n = mainnetName[c.id];
    if (n) c.name = n;
  }
  const mainnetExplorer: Partial<Record<ChainConfig["id"], { name: string; tx: (h: string) => string }>> = {
    polygon: { name: "Etherscan", tx: (h) => `https://etherscan.io/tx/${h}` },
    monad: { name: "Monad Explorer", tx: (h) => `https://monadexplorer.com/tx/${h}` },
    cosmos: { name: "Mintscan", tx: (h) => `https://www.mintscan.io/cosmos/tx/${h}` },
    celestia: { name: "Mintscan", tx: (h) => `https://www.mintscan.io/celestia/tx/${h}` },
    osmosis: { name: "Mintscan", tx: (h) => `https://www.mintscan.io/osmosis/tx/${h}` },
    sui: { name: "SuiScan", tx: (h) => `https://suiscan.xyz/mainnet/tx/${h}` },
    aptos: { name: "Aptos Explorer", tx: (h) => `https://explorer.aptoslabs.com/txn/${h}?network=mainnet` },
    polkadot: { name: "Polkascan", tx: (h) => `https://polkascan.io/polkadot/transaction/${h}` },
    bnb: { name: "BscScan", tx: (h) => `https://bscscan.com/tx/${h}` },
    solana: { name: "Solscan", tx: (h) => `https://solscan.io/tx/${h}` },
  };
  for (const c of CHAINS) {
    const e = mainnetExplorer[c.id];
    if (e) c.explorer = e;
  }
}

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
 *     "polygon" since we can't disambiguate Polygon vs Monad
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
