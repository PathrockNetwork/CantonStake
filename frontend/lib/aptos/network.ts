export const aptosNetwork = process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet"
  ? {
      chainId: 1,
      name: "mainnet" as const,
      rest: process.env.NEXT_PUBLIC_APTOS_REST || "https://fullnode.mainnet.aptoslabs.com",
      indexer: process.env.NEXT_PUBLIC_APTOS_INDEXER || "https://api.mainnet.aptoslabs.com/v1/graphql",
    }
  : {
      chainId: 2,
      name: "testnet" as const,
      rest: process.env.NEXT_PUBLIC_APTOS_REST || "https://fullnode.testnet.aptoslabs.com",
      indexer: process.env.NEXT_PUBLIC_APTOS_INDEXER || "https://api.testnet.aptoslabs.com/v1/graphql",
    };

export function assertAptosIndexerChainId(actual: number | string | null | undefined): void {
  if (actual === null || actual === undefined || Number(actual) !== aptosNetwork.chainId) {
    throw new Error(`Aptos indexer is on chain ${actual ?? "unknown"}; expected ${aptosNetwork.chainId}`);
  }
}

export function fullAptosAddress(value: string): string | null {
  if (!/^0x[0-9a-f]{1,64}$/i.test(value)) return null;
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

export const APTOS_MAX_U64 = (1n << 64n) - 1n;

export function aptosU64(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > APTOS_MAX_U64) {
    throw new Error("Aptos returned an invalid u64 balance");
  }
  return BigInt(value);
}

export function aptosDelegationStake(values: unknown[]): [bigint, bigint, bigint] {
  if (values.length !== 3) throw new Error("Aptos returned an invalid delegation stake view");
  return [aptosU64(values[0]), aptosU64(values[1]), aptosU64(values[2])];
}

export function aptosPendingWithdrawal(values: unknown[]): { ready: boolean; amount: bigint } {
  if (values.length !== 2 || typeof values[0] !== "boolean") throw new Error("Aptos returned an invalid pending withdrawal view");
  return { ready: values[0], amount: aptosU64(values[1]) };
}

export async function aptosView(functionId: string, args: string[], typeArguments: string[] = []): Promise<unknown[]> {
  const response = await fetch(`${aptosNetwork.rest}/v1/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ function: functionId, type_arguments: typeArguments, arguments: args }),
  });
  if (!response.ok) throw new Error(`Aptos view ${functionId} returned ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error(`Aptos view ${functionId} returned invalid data`);
  return result;
}
