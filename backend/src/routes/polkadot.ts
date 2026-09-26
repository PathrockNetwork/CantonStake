import type { FastifyPluginAsync } from "fastify";
import { polkadotApi, POLKADOT_ASSET_HUB } from "../services/polkadot-rpc.js";
import { config } from "../config.js";
import { comparePoolPoints } from "../services/polkadot-pool-scores.js";

type PoolJson = {
  state?: string;
  memberCounter?: number;
  points?: string | number;
  commission?: { current?: [number | string, string] | null };
};

const polkadotRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/polkadot/pools", async (_req, reply) => {
    try {
      const api = await polkadotApi();
      const entries = await api.query.nominationPools.bondedPools.entries();
      const open = entries.flatMap(([key, value]) => {
        const pool = value.toJSON() as PoolJson | null;
        if (!pool || pool.state !== "Open") return [];
        const id = Number(key.args[0]!.toString());
        if (!Number.isSafeInteger(id) || id <= 0) return [];
        return [{ id, pool }];
      });
      // Pool points are a share count, not a balance. This is only a picker
      // ordering; never present it as TVL or use it for settlement math.
      open.sort((a, b) => comparePoolPoints(a.pool, b.pool));
      const visible = open.slice(0, 100);
      const names = await api.query.nominationPools.metadata.multi(visible.map(({ id }) => id));
      const pools = visible.map(({ id, pool }, index) => {
        const hex = names[index]?.toHex() ?? "0x";
        const metadata = hex === "0x" ? "" : Buffer.from(hex.slice(2), "hex").toString("utf8").trim();
        const rawCommission = Number(pool.commission?.current?.[0] ?? 0);
        return {
          id,
          name: metadata || `Nomination pool #${id}`,
          commissionPct: Number.isFinite(rawCommission) ? rawCommission / 10_000_000 : 0,
          members: pool.memberCounter ?? 0,
        };
      });
      const network = POLKADOT_ASSET_HUB[config.networkMode];
      return {
        genesis: network.genesis,
        symbol: network.symbol,
        decimals: network.decimals,
        minJoinPlanck: (await api.query.nominationPools.minJoinBond()).toString(),
        bondingDurationEras: api.consts.staking.bondingDuration.toString(),
        pools,
      };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ error: "Polkadot Asset Hub nomination pools are unavailable" });
    }
  });
};

export default polkadotRoutes;
