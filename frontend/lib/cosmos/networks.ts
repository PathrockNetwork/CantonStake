import { rpcEndpoint } from "../rpc";
export type CosmosChainKey = "cosmos" | "celestia" | "osmosis";

export interface CosmosNetwork {
  key: CosmosChainKey;
  chainId: string;
  chainName: string;
  rpc: string;
  rest: string;
  prefix: string;
  symbol: string;
  denom: string;
  decimals: number;
  coinType: number;
  gasPrice: number;
}

const mainnet = process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet";

export const cosmosNetworks: Record<CosmosChainKey, CosmosNetwork> = {
  cosmos: {
    key: "cosmos",
    chainId: process.env.NEXT_PUBLIC_COSMOS_CHAIN_ID || (mainnet ? "cosmoshub-4" : "provider"),
    chainName: process.env.NEXT_PUBLIC_COSMOS_CHAIN_NAME || (mainnet ? "Cosmos Hub" : "Cosmos Hub Provider Testnet"),
    rpc: rpcEndpoint("cosmos"),
    rest: rpcEndpoint("cosmos-rest"),
    prefix: "cosmos",
    symbol: process.env.NEXT_PUBLIC_COSMOS_COIN_DENOM || "ATOM",
    denom: process.env.NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM || "uatom",
    decimals: Number(process.env.NEXT_PUBLIC_COSMOS_COIN_DECIMALS || "6"),
    coinType: Number(process.env.NEXT_PUBLIC_COSMOS_COIN_TYPE || "118"),
    gasPrice: 0.025,
  },
  celestia: {
    key: "celestia",
    chainId: mainnet ? "celestia" : "mocha-5",
    chainName: mainnet ? "Celestia" : "Celestia Mocha-5",
    // Browser requests use the server's checked pool, including endpoints
    // that do not themselves expose CORS headers.
    rpc: rpcEndpoint("celestia"),
    rest: rpcEndpoint("celestia-rest"),
    prefix: "celestia",
    symbol: "TIA",
    denom: "utia",
    decimals: 6,
    coinType: 118,
    gasPrice: 0.025,
  },
  osmosis: {
    key: "osmosis",
    chainId: mainnet ? "osmosis-1" : "osmo-test-5",
    chainName: mainnet ? "Osmosis" : "Osmosis Testnet",
    rpc: rpcEndpoint("osmosis"),
    rest: rpcEndpoint("osmosis-rest"),
    prefix: "osmo",
    symbol: "OSMO",
    denom: "uosmo",
    decimals: 6,
    coinType: 118,
    gasPrice: mainnet ? 0.1 : 0.025,
  },
};

// The backend and settlement watchers support these exact Hub networks and
// uatom amounts. An override cannot turn a testnet-labelled wallet into a
// mainnet signer or silently change the amount precision.
const hub = cosmosNetworks.cosmos;
const expectedHubChainId = mainnet ? "cosmoshub-4" : "provider";
if (hub.chainId !== expectedHubChainId) {
  throw new Error(`Cosmos Hub chain ${hub.chainId} does not match this frontend's network mode; expected ${expectedHubChainId}`);
}
if (hub.denom !== "uatom" || hub.decimals !== 6) {
  throw new Error("Cosmos Hub staking requires uatom with 6 decimals");
}

export const cosmosChainKeys: CosmosChainKey[] = ["cosmos", "celestia", "osmosis"];

export function isCosmosChainKey(value: string): value is CosmosChainKey {
  return cosmosChainKeys.includes(value as CosmosChainKey);
}
