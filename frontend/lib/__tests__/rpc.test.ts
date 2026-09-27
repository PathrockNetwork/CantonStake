import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe("shared RPC routing", () => {
  it.each(["testnet", "mainnet"])("all app-owned clients use mode-qualified gateway endpoints in %s", async (mode) => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_MODE", mode);
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://app.example/");
    vi.resetModules();
    const { rpcEndpoint } = await import("../rpc");
    for (const pool of ["settlement", "polygon", "monad", "bnb", "cosmos", "cosmos-rest", "celestia", "celestia-rest", "osmosis", "osmosis-rest", "aptos", "aptos-indexer", "sui", "solana", "polkadot"] as const) {
      expect(rpcEndpoint(pool)).toBe(`https://app.example/api/rpc/${mode}/${pool}`);
    }
    const [cosmos, aptos, sui, solana, polkadot] = await Promise.all([
      import("../cosmos/networks"), import("../aptos/network"), import("../sui/network"), import("../solana/network"), import("../polkadot/network"),
    ]);
    for (const key of ["cosmos", "celestia", "osmosis"] as const) {
      expect(cosmos.cosmosNetworks[key].rpc).toBe(rpcEndpoint(key));
      expect(cosmos.cosmosNetworks[key].rest).toBe(rpcEndpoint(`${key}-rest`));
    }
    expect(aptos.aptosNetwork.rest).toBe(rpcEndpoint("aptos"));
    expect(aptos.aptosNetwork.indexer).toBe(rpcEndpoint("aptos-indexer"));
    expect(sui.suiNetwork.graphql).toBe(rpcEndpoint("sui"));
    expect(solana.solanaNetwork.rpc).toBe(rpcEndpoint("solana"));
    expect(polkadot.polkadotNetwork.rpc).toBe(rpcEndpoint("polkadot"));
  });
});
