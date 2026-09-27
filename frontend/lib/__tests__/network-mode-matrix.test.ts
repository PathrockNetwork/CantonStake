import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

const supported = ["polygon", "monad", "cosmos", "celestia", "osmosis", "sui", "aptos", "polkadot", "bnb", "solana"];
const overrides = [
  "NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID", "NEXT_PUBLIC_POLYGON_STAKE_MANAGER",
  "NEXT_PUBLIC_POLYGON_STAKING_LOGGER", "NEXT_PUBLIC_POLYGON_STAKE_TOKEN",
  "NEXT_PUBLIC_COSMOS_CHAIN_ID", "NEXT_PUBLIC_COSMOS_CHAIN_NAME", "NEXT_PUBLIC_COSMOS_RPC", "NEXT_PUBLIC_COSMOS_REST",
  "NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM", "NEXT_PUBLIC_COSMOS_COIN_DECIMALS",
  "NEXT_PUBLIC_CELESTIA_RPC", "NEXT_PUBLIC_CELESTIA_REST", "NEXT_PUBLIC_OSMOSIS_RPC", "NEXT_PUBLIC_OSMOSIS_REST",
  "NEXT_PUBLIC_SUI_GRAPHQL_URL", "NEXT_PUBLIC_APTOS_REST", "NEXT_PUBLIC_APTOS_INDEXER",
  "NEXT_PUBLIC_SOLANA_RPC", "NEXT_PUBLIC_POLKADOT_RPC_URL",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("all-chain deployment mode matrix", () => {
  it("keeps mainnet Polygon-only unless explicitly configured otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_ENABLED_CHAINS", undefined);
    for (const key of overrides) vi.stubEnv(key, "");
    vi.resetModules();
    const { liveChains } = await import("@/lib/chains");
    expect(liveChains().map(chain => chain.id)).toEqual(["polygon"]);
  });

  it.each(["testnet", "mainnet"])("selects consistent identities and adapters in %s", async (mode) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_ENABLED_CHAINS", supported.join(","));
    for (const key of overrides) vi.stubEnv(key, "");
    vi.resetModules();
    const [chains, adapters, cosmos, sui, aptos, solana, polkadot] = await Promise.all([
      import("@/lib/chains"), import("@/lib/chains/index"), import("@/lib/cosmos/networks"),
      import("@/lib/sui/network"), import("@/lib/aptos/network"), import("@/lib/solana/network"), import("@/lib/polkadot/network"),
    ]);
    const mainnet = mode === "mainnet";
    expect(adapters.listAdapterIds().sort()).toEqual([...supported].sort());
    expect(chains.CHAINS.filter((chain) => chain.phase === "live").map((chain) => chain.id).sort()).toEqual([...supported].sort());
    for (const chain of chains.CHAINS) {
      expect(chain.hasAdapter, chain.id).toBe(true);
      expect(chain.testnet, chain.id).toBe(!mainnet);
      expect(adapters.adapterFor(chain.id).chainId, chain.id).toBe(chain.id);
    }
    expect(chains.polygonSettlementChain.id).toBe(mainnet ? 1 : 11155111);
    expect(chains.polygonNativeChain.id).toBe(mainnet ? 137 : 80002);
    expect(chains.monadEvmChain.id).toBe(mainnet ? 143 : 10143);
    expect(chains.bnbEvmChain.id).toBe(mainnet ? 56 : 97);
    expect(cosmos.cosmosNetworks.cosmos.chainId).toBe(mainnet ? "cosmoshub-4" : "provider");
    expect(cosmos.cosmosNetworks.celestia.chainId).toBe(mainnet ? "celestia" : "mocha-5");
    expect(cosmos.cosmosNetworks.osmosis.chainId).toBe(mainnet ? "osmosis-1" : "osmo-test-5");
    expect(sui.suiNetwork.name).toBe(mode);
    expect(() => sui.assertSuiNetworkIdentifier(sui.suiNetwork.identifier)).not.toThrow();
    expect(() => sui.assertSuiNetworkIdentifier("wrong-network")).toThrow();
    expect(aptos.aptosNetwork.chainId).toBe(mainnet ? 1 : 2);
    expect(() => aptos.assertAptosIndexerChainId(mainnet ? 2 : 1)).toThrow();
    expect(solana.solanaNetwork.name).toBe(mainnet ? "mainnet-beta" : "testnet");
    expect(() => solana.assertSolanaGenesis(solana.solanaNetwork.genesis)).not.toThrow();
    expect(() => solana.assertSolanaGenesis("wrong-network")).toThrow();
    expect(polkadot.polkadotNetwork).toMatchObject(mainnet
      ? { name: "Polkadot Asset Hub", symbol: "DOT", decimals: 10, ss58: 0 }
      : { name: "Westend Asset Hub", symbol: "WND", decimals: 12, ss58: 42 });
  }, 15_000); // Cold-imports every wallet SDK; no RPC calls are made.

  it.each([
    ["testnet", "NEXT_PUBLIC_COSMOS_CHAIN_ID", "cosmoshub-4"],
    ["mainnet", "NEXT_PUBLIC_COSMOS_CHAIN_ID", "provider"],
    ["testnet", "NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM", "uosmo"],
    ["mainnet", "NEXT_PUBLIC_COSMOS_COIN_DECIMALS", "18"],
  ])("rejects incompatible Cosmos Hub configuration in %s: %s=%s", async (mode, key, value) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", mode);
    for (const override of overrides) vi.stubEnv(override, "");
    vi.stubEnv(key, value);
    vi.resetModules();
    await expect(import("@/lib/cosmos/networks")).rejects.toThrow("Cosmos Hub");
  });
});
