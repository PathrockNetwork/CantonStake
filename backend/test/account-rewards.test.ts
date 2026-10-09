import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { accountRewardRoutesFor } from "../src/routes/account-rewards.js";

const wallet = `0x${"a".repeat(40)}`;
const token = `0x${"b".repeat(40)}`;
test("liquid CC history uses a stable holding ID and is restricted to the test deployment", async () => {
  for (const mode of ["testnet", "mainnet"] as const) {
    const queries: any[] = [];
    const app = Fastify();
    await app.register(accountRewardRoutesFor({ networkMode: mode, loopStakingEnabled: true,
      payoutsEnabled: true, rewardSource: "ledger-coupons", rewardModel: "mainnet-traffic", cantonNetwork: "devnet", template: "position",
      ledger: { activeContracts: async () => [] },
      db: {
        stakingPosition: { findMany: async () => [] }, rewardSweep: { findMany: async () => [] }, rewardRound: { findMany: async () => [] },
        rewardEvent: { findMany: async (query: any) => {
          queries.push(query);
          return query.where.position.chain.in.includes("polygon-liquid") ? [{ id: "event", createdAt: new Date(), userShare: "1.5",
            cantonTxId: null, userPayout: { status: "pending_acceptance", updateId: "offer-update" }, round: { roundNumber: 12 },
            position: { contractId: "changing-liquid-cid", chain: "polygon-liquid", evmAddress: wallet, validatorShare: token } }] : [];
        } },
      } as any,
    }));
    try {
      const response = await app.inject({ method: "POST", url: "/api/account/rewards", payload: { addresses: [wallet], clientNetworkMode: mode } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().policy.ccPayments, "enabled");
      assert.equal(response.json().policy.rewardModel, "mainnet-traffic");
      assert.equal(response.json().policy.identityVerificationRequired, true);
      const history = response.json().history.events;
      if (mode === "testnet") {
        assert.equal(history[0].positionId, `liquid:80002:${token}:${wallet}`);
        assert.equal(history[0].status, "Offered: accept in Loop");
      } else assert.equal(history.length, 0);
      assert.equal(queries[0].where.position.chain.in.includes("polygon-liquid"), mode === "testnet");
    } finally { await app.close(); }
  }
});

test("a ledger outage preserves recorded allocations and does not pretend payments are enabled", async () => {
  const app = Fastify();
  await app.register(accountRewardRoutesFor({ networkMode: "testnet", loopStakingEnabled: false, payoutsEnabled: false, template: "position",
    ledger: { activeContracts: async () => { throw new Error("offline"); } },
    db: { rewardSweep: { findMany: async () => [] }, rewardEvent: { findMany: async () => [] } } as any,
  }));
  try {
    const response = await app.inject({ method: "POST", url: "/api/account/rewards", payload: { addresses: [wallet], clientNetworkMode: "testnet" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().positions, null);
    assert.deepEqual(response.json().history.events, []);
    assert.equal(response.json().policy.ccPayments, "disabled");
  } finally { await app.close(); }
});
