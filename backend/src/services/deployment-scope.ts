export type NetworkMode = "mainnet" | "testnet";

const chains = new Set([
  "polygon", "monad", "cosmos", "celestia", "osmosis", "sui", "aptos", "polkadot", "bnb", "solana",
]);

/** Bare chain names belong to the owning deployment's separate database.
 * Explicit network suffixes must agree with that deployment as well. */
export function deploymentChain(raw: string, mode: NetworkMode): string | null {
  const suffix = raw.match(/-(amoy|testnet|mainnet)$/)?.[1];
  if (suffix && (suffix === "mainnet" ? mode !== "mainnet" : mode !== "testnet")) return null;
  if (suffix === "amoy" && raw !== "polygon-amoy") return null;
  const chain = suffix ? raw.slice(0, -(suffix.length + 1)) : raw;
  return chains.has(chain) ? chain : null;
}

/** Shared Canton parties are NOT a network boundary. A deployment-local
 * mirror is required; never guess ownership from a wallet or token amount. */
export function deploymentPositions<C extends { contractId: string }, M extends { contractId: string; chain: string }>(
  contracts: C[], mirrors: M[], mode: NetworkMode,
): Array<C & { chainMeta: M }> {
  const byCid = new Map(mirrors.filter(m => deploymentChain(m.chain, mode)).map(m => [m.contractId, m]));
  return contracts.flatMap(contract => {
    const mirror = byCid.get(contract.contractId);
    return mirror ? [{ ...contract, chainMeta: mirror }] : [];
  });
}
