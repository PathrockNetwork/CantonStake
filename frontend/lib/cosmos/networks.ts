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
    rpc: process.env.NEXT_PUBLIC_COSMOS_RPC || (mainnet ? "https://cosmos-rpc.polkachu.com" : "https://cosmoshub-testnet.rpc.kjnodes.com"),
    rest: process.env.NEXT_PUBLIC_COSMOS_REST || (mainnet ? "https://cosmos-api.polkachu.com" : "https://cosmoshub-testnet.api.kjnodes.com"),
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
    // POPS serves Mocha but omits Access-Control-Allow-Origin; browser
    // signing and reads use the CORS-enabled nodes.guru endpoints.
    rpc: process.env.NEXT_PUBLIC_CELESTIA_RPC || (mainnet ? "https://celestia-rpc.polkachu.com" : "https://rpc-1.testnet.celestia.nodes.guru"),
    rest: process.env.NEXT_PUBLIC_CELESTIA_REST || (mainnet ? "https://celestia-api.polkachu.com" : "https://api-1.testnet.celestia.nodes.guru"),
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
    rpc: process.env.NEXT_PUBLIC_OSMOSIS_RPC || (mainnet ? "https://rpc.osmosis.zone" : "https://rpc.testnet.osmosis.zone"),
    rest: process.env.NEXT_PUBLIC_OSMOSIS_REST || (mainnet ? "https://lcd.osmosis.zone" : "https://lcd.testnet.osmosis.zone"),
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
