import type { ApiPromise } from "@polkadot/api";
import { formatUnits } from "viem";
import { config } from "../config.js";
import { polkadotApi, POLKADOT_ASSET_HUB } from "./polkadot-rpc.js";

export interface PolkadotPoolScoreRow {
  address: string;
  name: string;
  commissionPct: number;
  totalStaked: number;
}

export function comparePoolPoints(
  a: { points?: string | number },
  b: { points?: string | number },
): number {
  const points = (value: string | number | undefined) => {
    try { return BigInt(String(value ?? 0)); } catch { return 0n; }
  };
  const left = points(a.points);
  const right = points(b.points);
  return left === right ? 0 : left > right ? -1 : 1;
}

/** Read the same top 100 open pools as the picker, with real runtime-API
 * balances. Pool points rank the picker but are not an economic balance. */
export async function listPolkadotPoolScoreRows(injectedApi?: ApiPromise): Promise<PolkadotPoolScoreRow[]> {
  const api = injectedApi ?? await polkadotApi();
  if (!api.call.nominationPoolsApi?.poolBalance) {
    throw new Error("Polkadot Asset Hub does not expose nominationPoolsApi.poolBalance");
  }
  const entries = await api.query.nominationPools.bondedPools.entries();
  const open = entries.flatMap(([key, value]) => {
    const pool = value.toJSON() as {
      state?: string;
      points?: string | number;
      commission?: { current?: [number | string, string] | null };
    } | null;
    const id = Number(key.args[0]?.toString());
    return pool?.state === "Open" && Number.isSafeInteger(id) && id > 0
      ? [{ id, pool }] : [];
  });
  open.sort((a, b) => comparePoolPoints(a.pool, b.pool));
  const visible = open.slice(0, 100);
  if (visible.length === 0) return [];
  const metadata = await api.query.nominationPools.metadata.multi(visible.map(({ id }) => id));
  const decimals = POLKADOT_ASSET_HUB[config.networkMode].decimals;
  const rows: PolkadotPoolScoreRow[] = [];
  // Bound public-RPC traffic. A failed balance read cannot become fake TVL
  // or a scored pool; other pools remain available in the snapshot.
  for (let start = 0; start < visible.length; start += 8) {
    const batch = await Promise.allSettled(visible.slice(start, start + 8).map(async ({ id, pool }, offset) => {
      const balance = BigInt((await api.call.nominationPoolsApi.poolBalance(id)).toString());
      if (balance <= 0n) return null;
      const hex = metadata[start + offset]?.toHex() ?? "0x";
      const name = hex === "0x" ? "" : Buffer.from(hex.slice(2), "hex").toString("utf8").trim();
      const rawCommission = Number(pool.commission?.current?.[0] ?? 0);
      return {
        address: `pool:${id}`,
        name: name || `Nomination pool #${id}`,
        commissionPct: Number.isFinite(rawCommission) ? rawCommission / 10_000_000 : 0,
        totalStaked: Number(formatUnits(balance, decimals)),
      } satisfies PolkadotPoolScoreRow;
    }));
    for (const result of batch) {
      if (result.status === "fulfilled" && result.value) rows.push(result.value);
      else if (result.status === "rejected") console.warn("[validator-scoring] Polkadot pool balance unavailable:", result.reason);
    }
  }
  return rows;
}
