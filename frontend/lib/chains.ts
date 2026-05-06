import type { Chain } from "viem";
import { polygonAmoy } from "wagmi/chains";

export type ChainPhase = "live" | "planned" | "soon";

export type ChainConfig = {
  id: "polygon" | "moonbeam" | "monad" | "polkadot" | "cosmos" | "sui";
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

const validatorContract = process.env
  .NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}` | undefined;

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
    name: "Moonbeam",
    type: "Polkadot parachain",
    apy: 12.0,
    apyRange: "10-15%",
    unbonding: "28 days",
    ledgerApp: "Moonbeam",
    color: "#53cbc8",
    minStake: 50,
    validators: 64,
    tvl: "$140M",
  },
  {
    id: "monad",
    phase: "live",
    hasAdapter: true,
    symbol: "MON",
    name: "Monad",
    type: "EVM-compatible L1",
    apy: 8.0,
    apyRange: "8-12%",
    unbonding: "14 days",
    ledgerApp: "Ethereum",
    color: "#836ef9",
    minStake: 10,
    validators: 200,
    tvl: "$420M",
  },
  {
    id: "cosmos",
    phase: "live",
    hasAdapter: true,
    symbol: "ATOM",
    name: "Cosmos",
    type: "IBC-enabled L1",
    apy: 21.0,
    apyRange: "17-22%",
    unbonding: "21 days",
    ledgerApp: "Cosmos",
    color: "#6f7390",
    minStake: 1,
    validators: 180,
    tvl: "-",
  },
  {
    id: "sui",
    phase: "live",
    hasAdapter: true,
    symbol: "SUI",
    name: "Sui",
    type: "Move-based L1",
    apy: 3.5,
    apyRange: "3-4%",
    unbonding: "1 epoch (~24h)",
    ledgerApp: "Sui",
    color: "#4ca2ff",
    minStake: 1,
    validators: 100,
    tvl: "-",
  },
];

export const liveChains = () => CHAINS.filter((chain) => chain.phase === "live");
export const chainById = (id: string) => CHAINS.find((chain) => chain.id === id);
export const polygonChain = () => chainById("polygon")!;

if (process.env.NODE_ENV !== "production") {
  const ids = new Set<string>();

  if (polygonChain().id !== "polygon") {
    console.warn("[chains] polygonChain() did not resolve to polygon");
  }

  for (const chain of CHAINS) {
    if (ids.has(chain.id)) console.warn(`[chains] duplicate chain id ${chain.id}`);
    ids.add(chain.id);

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
