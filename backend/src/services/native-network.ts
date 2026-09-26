import { config } from "../config.js";

export type CosmosChain = "cosmos" | "celestia" | "osmosis";

const COSMOS_IDS: Record<CosmosChain, { testnet: string; mainnet: string }> = {
  cosmos: { testnet: "provider", mainnet: "cosmoshub-4" },
  celestia: { testnet: "mocha-5", mainnet: "celestia" },
  osmosis: { testnet: "osmo-test-5", mainnet: "osmosis-1" },
};

const SUI_IDS = {
  testnet: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  mainnet: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
} as const;

export function assertSuiChainIdentifier(actual: string | undefined): void {
  const expected = SUI_IDS[config.networkMode];
  if (actual !== expected) throw new Error(`Sui GraphQL is on ${actual ?? "unknown"}; expected ${expected}`);
}

export function assertAptosChainId(actual: number | undefined): void {
  const expected = config.networkMode === "mainnet" ? 1 : 2;
  if (actual !== expected) throw new Error(`Aptos fullnode is on chain ${actual ?? "unknown"}; expected ${expected}`);
}

export function assertCosmosChainIdentity(
  chain: CosmosChain,
  actual: string | undefined,
  catchingUp: boolean | undefined,
): void {
  const expected = COSMOS_IDS[chain][config.networkMode];
  if (actual !== expected) throw new Error(`${chain} RPC is on ${actual ?? "unknown"}; expected ${expected}`);
  if (catchingUp) throw new Error(`${chain} RPC is still catching up`);
}

export async function assertCosmosRpcNetwork(chain: CosmosChain): Promise<void> {
  const url = chain === "cosmos" ? config.cosmosRpcUrl
    : chain === "celestia" ? config.celestiaRpcUrl : config.osmosisRpcUrl;
  const response = await fetch(`${url.replace(/\/$/, "")}/status`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${chain} RPC status returned ${response.status}`);
  const body = await response.json() as {
    result?: { node_info?: { network?: string }; sync_info?: { catching_up?: boolean } };
  };
  assertCosmosChainIdentity(chain, body.result?.node_info?.network, body.result?.sync_info?.catching_up);
}

export async function assertSuiGraphqlNetwork(): Promise<void> {
  const response = await fetch(config.suiGraphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ chainIdentifier }" }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Sui GraphQL returned ${response.status}`);
  const body = await response.json() as {
    data?: { chainIdentifier?: string };
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) throw new Error(`Sui GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  assertSuiChainIdentifier(body.data?.chainIdentifier);
}
