/** viem's configured chain describes how to format requests; it does not
 * prove that an override RPC URL serves that chain. Check eth_chainId before
 * accepting an intent or consuming staking events. */
export function assertPolygonSettlementMode(
  mode: "testnet" | "mainnet",
  chainId: number,
): void {
  const expected = mode === "mainnet" ? 1 : 11155111;
  if (chainId !== expected) {
    throw new Error(`Polygon ${mode} settlement must use chain ${expected}, not ${chainId}`);
  }
}

export async function assertEvmRpcChainId(
  client: { getChainId(): Promise<number> },
  expected: number,
  label: string,
): Promise<void> {
  const actual = await client.getChainId();
  if (!Number.isSafeInteger(actual) || actual !== expected) {
    throw new Error(`${label} RPC is on chain ${actual}; expected ${expected}`);
  }
}
