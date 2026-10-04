import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { accountPositionRoutesFor } from "../src/routes/account-positions.js";
import { deploymentChain, deploymentPositions } from "../src/services/deployment-scope.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const contracts = ["mainnet", "testnet", "foreign", "other-wallet"].map(contractId => ({
  contractId, templateId: "position", argument: { evmAddress: contractId === "other-wallet" ? "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" : wallet,
    status: "Bonded", amountPol: "10", lastBondProof: { txHash: "original-proof" } },
}));
const mirror = (contractId: string, chain: string) => ({ contractId, chain, validatorId: 173, validatorAddress: "173",
  validatorShare: "staking-contract", evmTxHash: "original-proof", unbondNonce: "7", unbondWithdrawEpoch: "42", suiStakedObjectId: null });

async function setup(mode: "testnet" | "mainnet", records: ReturnType<typeof mirror>[]) {
  const observed: any[] = [];
  const deps = {
    ledger: { activeContracts: async () => contracts },
    db: {
      stakingPosition: { findMany: async (query: any) => { observed.push(query); return records; } },
      stakingIntent: { findMany: async (query: any) => { observed.push(query); return records.map(r => ({ requestContractId: r.contractId, chain: r.chain })); } },
    },
    templates: { StakingPosition: "position", StakingRequest: "request" }, networkMode: mode,
  };
  const app = Fastify();
  await app.register(accountPositionRoutesFor(deps as any));
  return { app, deps, observed };
}

test("shared ledger positions are isolated by each deployment's own mirror, even for the same wallet", async () => {
  for (const mode of ["mainnet", "testnet"] as const) {
    const { app, observed } = await setup(mode, [mirror(mode, mode === "testnet" ? "monad" : "polygon")]);
    try {
      const response = await app.inject(`/api/positions?address=${wallet.toUpperCase().replace('0X', '0x')}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      const positions = response.json().positions;
      assert.deepEqual(positions.map((p: any) => p.contractId), [mode]);
      assert.equal(positions[0].argument.status, "Bonded");
      assert.equal(positions[0].argument.lastBondProof.txHash, "original-proof");
      assert.equal(positions[0].chainMeta.unbondWithdrawEpoch, "42");
      assert(!observed[0].where.contractId.in.includes("other-wallet"));
    } finally { await app.close(); }
  }
});
test("unscoped position listings cannot expose foreign or unmirrored contracts", async () => {
  const { app } = await setup("mainnet", [mirror("mainnet", "polygon"), mirror("testnet", "monad-testnet")]);
  try {
    assert.deepEqual((await app.inject('/api/positions')).json().positions.map((p: any) => p.contractId), ["mainnet"]);
    assert.deepEqual((await app.inject(`/api/positions?address=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`)).json().positions, []);
  } finally { await app.close(); }
});
test("pending requests also require a local, network-compatible intent", async () => {
  const { app, observed } = await setup("testnet", [mirror("testnet", "monad"), mirror("mainnet", "polygon-mainnet")]);
  try {
    const response = await app.inject(`/api/requests?address=${wallet}`);
    assert.deepEqual(response.json().requests.map((p: any) => p.contractId), ["testnet"]);
    assert.equal(observed[0].where.acceptedAt, null);
    assert(!response.body.includes('chainMeta'));
  } finally { await app.close(); }
});
test("local database failures are explicit and never fall back to shared ledger contracts", async () => {
  const { app, deps } = await setup("mainnet", []);
  deps.db.stakingPosition.findMany = async () => { throw new Error('private database detail'); };
  deps.db.stakingIntent.findMany = async () => { throw new Error('private database detail'); };
  try {
    for (const path of ["/api/positions", "/api/requests"]) {
      const response = await app.inject(path);
      assert.equal(response.statusCode, 503);
      assert(!response.body.includes('private database detail'));
      assert(!response.body.includes('original-proof'));
    }
  } finally { await app.close(); }
});
test("an empty local mirror remains empty even when the shared ledger has stakes", async () => {
  const { app } = await setup("mainnet", []);
  try { assert.deepEqual((await app.inject('/api/positions')).json().positions, []); }
  finally { await app.close(); }
});
test("explicit network suffixes and supported chains are fail-closed", () => {
  assert.equal(deploymentChain("monad", "mainnet"), "monad");
  assert.equal(deploymentChain("monad-mainnet", "mainnet"), "monad");
  assert.equal(deploymentChain("monad-testnet", "mainnet"), null);
  assert.equal(deploymentChain("monad-mainnet", "testnet"), null);
  assert.equal(deploymentChain("polygon-amoy", "testnet"), "polygon");
  assert.equal(deploymentChain("polygon-amoy", "mainnet"), null);
  for (const chain of ["unknown", "monad-amoy", "polygon-unknown", "__proto__"]) {
    assert.equal(deploymentChain(chain, "mainnet"), null);
    assert.equal(deploymentChain(chain, "testnet"), null);
  }
  assert.deepEqual(deploymentPositions(contracts, [mirror("foreign", "unknown")], "mainnet"), []);
});
