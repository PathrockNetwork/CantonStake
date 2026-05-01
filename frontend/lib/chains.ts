import type { Chain } from "viem";
import { polygonAmoy } from "wagmi/chains";

export type ChainPhase = "live" | "planned" | "soon";

export type ChainConfig = {
  id: "polygon" | "moonbeam" | "monad" | "polkadot" | "cosmos";
  phase: ChainPhase;
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
    phase: "planned",
    symbol: "GLMR",
    name: "Moonbeam",
    type: "Polkadot parachain",
    apy: 12.4,
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
    phase: "planned",
    symbol: "MON",
    name: "Monad",
    type: "EVM-compatible L1",
    apy: 9.8,
    apyRange: "8-12%",
    unbonding: "14 days",
    ledgerApp: "Ethereum",
    color: "#836ef9",
    minStake: 10,
    validators: 200,
    tvl: "$420M",
  },
  {
    id: "polkadot",
    phase: "soon",
    symbol: "DOT",
    name: "Polkadot",
    type: "Relay chain",
    apy: 14.8,
    apyRange: "14-16%",
    unbonding: "28 days",
    ledgerApp: "Polkadot",
    color: "#e6007a",
    minStake: 1,
    validators: 297,
    tvl: "-",
  },
  {
    id: "cosmos",
    phase: "soon",
    symbol: "ATOM",
    name: "Cosmos",
    type: "IBC-enabled L1",
    apy: 19.2,
    apyRange: "17-22%",
    unbonding: "21 days",
    ledgerApp: "Cosmos",
    color: "#6f7390",
    minStake: 1,
    validators: 180,
    tvl: "-",
  },
];

export const liveChains = () => CHAINS.filter((chain) => chain.phase === "live");
export const chainById = (id: string) => CHAINS.find((chain) => chain.id === id);
export const polygonChain = () => chainById("polygon")!;
