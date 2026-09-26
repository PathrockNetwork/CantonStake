import { QueryClient, setupBankExtension, setupStakingExtension } from "@cosmjs/stargate";
import { connectComet } from "@cosmjs/tendermint-rpc";
import type { Position } from "@/lib/chains/types";
import type { CosmosNetwork } from "./networks";

type Page<T> = { rows: T[]; nextKey?: Uint8Array };

export async function collectCosmosPages<T>(
  getPage: (key?: Uint8Array) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const seenKeys = new Set<string>();
  let key: Uint8Array | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await getPage(key);
    rows.push(...result.rows);
    if (!result.nextKey?.length) return rows;
    const marker = Array.from(result.nextKey).join(",");
    if (seenKeys.has(marker)) throw new Error("Cosmos staking pagination stalled");
    seenKeys.add(marker);
    key = result.nextKey;
  }
  throw new Error("Cosmos staking pagination exceeded 50 pages");
}

export async function readCosmosPositions(network: CosmosNetwork, address: string): Promise<Position[]> {
  if (!address.startsWith(`${network.prefix}1`)) {
    throw new Error(`Address is not a ${network.chainName} account`);
  }
  const comet = await connectComet(network.rpc);
  try {
    const status = await comet.status();
    assertCosmosRpcStatus(network, status.nodeInfo.network, status.syncInfo.catchingUp);
    const query = QueryClient.withExtensions(comet, setupStakingExtension);
    const [delegations, unbondings] = await Promise.all([
      collectCosmosPages(async (key) => {
        const result = await query.staking.delegatorDelegations(address, key);
        return { rows: result.delegationResponses, nextKey: result.pagination?.nextKey };
      }),
      collectCosmosPages(async (key) => {
        const result = await query.staking.delegatorUnbondingDelegations(address, key);
        return { rows: result.unbondingResponses, nextKey: result.pagination?.nextKey };
      }),
    ]);
    const positions: Position[] = [];
    for (const row of delegations) {
      if (row.balance.denom !== network.denom) continue;
      const amount = BigInt(row.balance.amount || "0");
      if (amount > 0n) positions.push({
        validator: row.delegation.validatorAddress,
        amount,
        status: "bonded",
      });
    }
    for (const row of unbondings) {
      for (const entry of row.entries) {
        positions.push({
          validator: row.validatorAddress,
          amount: BigInt(entry.balance || "0"),
          status: "unbonding",
          unbondingReadyAt: Number(entry.completionTime.seconds),
        });
      }
    }
    return positions;
  } finally {
    comet.disconnect();
  }
}

export function assertCosmosRpcStatus(network: CosmosNetwork, actual: string, catchingUp: boolean): void {
  if (actual !== network.chainId) {
    throw new Error(`${network.chainName} RPC is on ${actual}; expected ${network.chainId}`);
  }
  if (catchingUp) throw new Error(`${network.chainName} RPC is still catching up`);
}

export async function readCosmosBalance(network: CosmosNetwork, address: string): Promise<bigint> {
  if (!address.startsWith(`${network.prefix}1`)) {
    throw new Error(`Address is not a ${network.chainName} account`);
  }
  const comet = await connectComet(network.rpc);
  try {
    const status = await comet.status();
    assertCosmosRpcStatus(network, status.nodeInfo.network, status.syncInfo.catchingUp);
    const query = QueryClient.withExtensions(comet, setupBankExtension);
    const coin = await query.bank.balance(address, network.denom);
    if (coin.denom !== network.denom) throw new Error("Balance denom mismatch");
    return BigInt(coin.amount || "0");
  } finally {
    comet.disconnect();
  }
}
