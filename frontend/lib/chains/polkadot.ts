import { parseUnits } from "viem";
import { fetchPositions } from "../api";
import { polkadotApi, polkadotNetwork } from "../polkadot/network";
import { ChainAdapterError, type IChainAdapter, type Position, type UnsignedTx, type Validator } from "./types";

type PoolResponse = {
  genesis: string;
  decimals: number;
  minJoinPlanck: string;
  pools: Array<{ id: number; name: string; commissionPct: number }>;
};

function poolId(value: string): number {
  if (!/^pool:[1-9]\d*$/.test(value)) throw new ChainAdapterError("VALIDATOR_NOT_FOUND", "Choose a nomination pool");
  const id = Number(value.slice(5));
  if (!Number.isSafeInteger(id)) throw new ChainAdapterError("VALIDATOR_NOT_FOUND", "Invalid nomination-pool ID");
  return id;
}

export async function fetchPolkadotPools(): Promise<PoolResponse> {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";
  const response = await fetch(`${backend}/api/polkadot/pools`);
  if (!response.ok) throw new ChainAdapterError("NETWORK", "Polkadot nomination pools are unavailable");
  const body = await response.json() as PoolResponse;
  if (body.genesis !== polkadotNetwork.genesis || body.decimals !== polkadotNetwork.decimals ||
      !/^\d+$/.test(body.minJoinPlanck) || !Array.isArray(body.pools)) {
    throw new ChainAdapterError("NETWORK", "Polkadot pool data is from the wrong Asset Hub network");
  }
  return body;
}

export const polkadotAdapter: IChainAdapter = {
  chainId: "polkadot",

  async getValidators(): Promise<Validator[]> {
    const { pools } = await fetchPolkadotPools();
    return pools.map((pool) => ({
      address: `pool:${pool.id}`, name: pool.name, apr: 0,
      commission: pool.commissionPct, uptime: Number.NaN,
    }));
  },

  async getDelegations(address: string): Promise<Position[]> {
    const api = await polkadotApi();
    const member = (await api.query.nominationPools.poolMembers(address)).toJSON() as
      { poolId?: number; points?: number | string } | null;
    const positions = (await fetchPositions(address)).filter((row) =>
      row.chainMeta?.chain === "polkadot" && row.argument.status !== "Released");
    return positions.flatMap((row) => {
      const pool = row.chainMeta?.validatorShare;
      if (!pool || !member || poolId(pool) !== member.poolId) return [];
      return [{ validator: pool,
        amount: parseUnits(row.argument.amountPol, polkadotNetwork.decimals),
        status: row.argument.status === "Unbonding" ? "unbonding" as const : "bonded" as const }];
    });
  },

  async buildDelegateTx({ validator, amount }) {
    const id = poolId(validator);
    const { minJoinPlanck } = await fetchPolkadotPools();
    if (amount < BigInt(minJoinPlanck)) throw new ChainAdapterError("INSUFFICIENT_BALANCE", "Amount is below the live nomination-pool minimum");
    return { kind: "substrate", method: "nominationPools.join", args: [amount.toString(), id] } satisfies UnsignedTx;
  },

  async buildUndelegateTx({ validator, delegator }) {
    poolId(validator);
    return { kind: "substrate", method: "nominationPools.unbond", args: [delegator, "all"] } satisfies UnsignedTx;
  },

  async buildClaimTx({ validator, delegator }) {
    poolId(validator);
    return { kind: "substrate", method: "nominationPools.withdrawUnbonded", args: [delegator, 0] } satisfies UnsignedTx;
  },

  async estimateGas(tx) {
    if (tx.kind !== "substrate") throw new ChainAdapterError("NETWORK", "Not a Polkadot transaction");
    return 0n;
  },

  watchPosition(address, cb) {
    let cancelled = false;
    const tick = async () => {
      try {
        const positions = await polkadotAdapter.getDelegations(address);
        if (!cancelled) cb(positions[0] ?? { validator: "", amount: 0n, status: "released" });
      } catch { /* retry after a transient RPC failure */ }
    };
    void tick();
    const timer = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  },
};
