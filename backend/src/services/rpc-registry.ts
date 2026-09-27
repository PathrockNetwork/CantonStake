import { config } from "../config.js";
import { endpointList, RpcPool } from "./rpc-pool.js";
import { identityCheck, type RpcIdentity } from "./rpc-policy.js";

const mainnet = config.networkMode === "mainnet";
const mode = (testnet: string, production: string) => mainnet ? production : testnet;
type Definition = RpcIdentity & { primary: string; backups: string[] };

// Sources and operational caveats are documented in README's RPC failover
// section. Every URL, including operator overrides, is identity-checked at
// runtime. Different hostnames are not a guarantee of independent operators.
export const rpcDefinitions = {
  settlement: { protocol: "evm", chainId: mode("11155111", "1"), primary: config.stakeSettlementRpcUrl,
    backups: [config.stakeSettlementFallbackRpcUrl, mode("https://ethereum-sepolia-rpc.publicnode.com", "https://ethereum-rpc.publicnode.com"), mode("https://rpc.sepolia.ethpandaops.io", "https://eth.drpc.org")] },
  polygon: { protocol: "evm", chainId: mode("80002", "137"), primary: config.amoyRpcUrl,
    backups: [mode("https://polygon-amoy.drpc.org", "https://polygon.drpc.org")] },
  monad: { protocol: "evm", chainId: mode("10143", "143"), primary: config.monadRpcUrl,
    backups: [mode("https://rpc.ankr.com/monad_testnet", "https://rpc1.monad.xyz")] },
  bnb: { protocol: "evm", chainId: mode("97", "56"), primary: config.bnbRpcUrl,
    backups: [mode("https://data-seed-prebsc-1-s1.bnbchain.org:8545", "https://bsc-dataseed.bnbchain.org")] },
  cosmos: { protocol: "cosmos", chainId: mode("provider", "cosmoshub-4"), primary: config.cosmosRpcUrl,
    backups: [mode("https://cosmos-testnet-rpc.polkachu.com", "https://cosmos-rpc.publicnode.com")] },
  "cosmos-rest": { protocol: "cosmos-rest", chainId: mode("provider", "cosmoshub-4"), primary: config.cosmosRestUrl,
    backups: [mode("https://cosmos-testnet-api.polkachu.com", "https://cosmos-rest.publicnode.com")] },
  celestia: { protocol: "cosmos", chainId: mode("mocha-5", "celestia"), primary: config.celestiaRpcUrl,
    // Mainnet catch-up needs block_results older than publicnode's 3,000-block
    // retention. Kjnodes + itrocket served the same historical completion.
    backups: [mode("https://rpc-1.testnet.celestia.nodes.guru", "https://celestia-mainnet-rpc.itrocket.net"),
      ...(mainnet ? ["https://celestia-rpc.publicnode.com"] : ["https://celestia-testnet-rpc.itrocket.net"])] },
  "celestia-rest": { protocol: "cosmos-rest", chainId: mode("mocha-5", "celestia"), primary: config.celestiaRestUrl,
    backups: [mode("https://api-1.testnet.celestia.nodes.guru", "https://celestia-rest.publicnode.com")] },
  osmosis: { protocol: "cosmos", chainId: mode("osmo-test-5", "osmosis-1"), primary: config.osmosisRpcUrl,
    backups: [mode("https://rpc.osmotest5.osmosis.zone", "https://osmosis-rpc.polkachu.com")] },
  "osmosis-rest": { protocol: "cosmos-rest", chainId: mode("osmo-test-5", "osmosis-1"), primary: config.osmosisRestUrl,
    backups: [mode("https://lcd.osmotest5.osmosis.zone", "https://osmosis-api.polkachu.com")] },
  aptos: { protocol: "aptos", chainId: mode("2", "1"), primary: config.aptosRestUrl,
    backups: [mode("https://api.testnet.aptoslabs.com", "https://api.mainnet.aptoslabs.com")] },
  // Aptos's second mainnet hostname is live but shares the same operator.
  // Testnet indexer and Sui GraphQL backups need operator provisioning.
  // Never substitute a JSON-RPC endpoint, another network, or a dead alias.
  "aptos-indexer": { protocol: "aptos-indexer", chainId: mode("2", "1"), primary: config.aptosIndexerUrl,
    backups: mainnet ? ["https://indexer.mainnet.aptoslabs.com/v1/graphql"] : [] },
  sui: { protocol: "sui", chainId: mode("69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD", "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"), primary: config.suiGraphqlUrl, backups: [] },
  solana: { protocol: "solana", chainId: mode("4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"), primary: config.solanaRpcUrl,
    backups: [mode("https://solana-testnet-rpc.publicnode.com", "https://solana-rpc.publicnode.com")] },
  polkadot: { protocol: "polkadot", chainId: mode("0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9", "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f"), primary: config.polkadotRpcUrl,
    backups: [mode("https://asset-hub-westend-rpc.n.dwellir.com", "https://asset-hub-polkadot-rpc.n.dwellir.com")] },
} satisfies Record<string, Definition>;

export type RpcPoolName = keyof typeof rpcDefinitions;

export function parseRpcBackups(raw: string): Partial<Record<RpcPoolName, string[]>> {
  let value: unknown;
  try { value = JSON.parse(raw || "{}"); } catch { throw new Error("RPC_FALLBACK_URLS must be a JSON object"); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("RPC_FALLBACK_URLS must be a JSON object");
  for (const [key, urls] of Object.entries(value)) {
    if (!Object.hasOwn(rpcDefinitions, key) || !Array.isArray(urls) || urls.some((url) => typeof url !== "string")) {
      throw new Error("RPC_FALLBACK_URLS contains an unknown pool or invalid endpoint list");
    }
  }
  return value as Partial<Record<RpcPoolName, string[]>>;
}

const backups = parseRpcBackups(process.env.RPC_FALLBACK_URLS ?? "");
export const rpcPools = Object.fromEntries(Object.entries(rpcDefinitions).map(([name, definition]) => [
  name, new RpcPool(name, endpointList(definition.primary, backups[name as RpcPoolName] ?? definition.backups), identityCheck(definition),
    // Sui GraphQL execution's documented default timeout is 74 seconds.
    // Keep fast read failover, but do not cut a single submission off at 4s.
    definition.protocol === "sui" ? { writeTimeoutMs: 80_000 } : {}),
])) as Record<RpcPoolName, RpcPool>;

/** Backend SDKs use the same checked gateway as browser clients. */
export const rpcUrls = Object.fromEntries(Object.keys(rpcDefinitions).map((name) => [
  name, `http://127.0.0.1:${config.port}/api/rpc/${config.networkMode}/${name}`,
])) as Record<RpcPoolName, string>;
