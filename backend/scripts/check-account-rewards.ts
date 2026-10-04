/** Staged route against the actual TestNet DB and both real ledger sources.
 * No mock wallets, ledger commands, database changes, or HTTP listening server.
 * PostgreSQL enforces READ ONLY for every query made by the route.
 */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { CantonClient } from "../src/services/canton-ledger-client.js";
import { CantonCutoverClient } from "../src/services/canton-cutover-client.js";
import { accountRewardRoutesFor } from "../src/routes/account-rewards.js";
import { normalizeWalletAddress } from "../src/services/wallet-address.js";
import { validPortfolioAddress } from "../src/services/portfolio-recorded.js";

async function main() {
  const address = process.argv[2];
  if (!address || !validPortfolioAddress(address)) throw new Error("Pass an actual native wallet address as the first argument");
  const old = parse(await readFile(new URL("../../.env", import.meta.url)));
  const testnet = parse(await readFile(new URL("../../.env.testnet", import.meta.url)));
  if (testnet.NETWORK_MODE !== "testnet" || testnet.POSTGRES_PORT !== "5434") throw new Error("TestNet DB port/mode does not match the existing deployment");
  const endpoint = new URL(old.CANTON_JSON_API_URL || "http://localhost:3975");
  if (!["localhost", "127.0.0.1", "host.docker.internal"].includes(endpoint.hostname)) throw new Error("Existing LocalNet source was not recognized");
  if (endpoint.hostname === "host.docker.internal") endpoint.hostname = "127.0.0.1";
  if (!old.CANTON_APP_PROVIDER_PARTY) throw new Error("Existing LocalNet provider is missing");
  const primary = new CantonClient("https://api.canton.cttestnet.pathrocknetwork.org/api/json-api", process.env.CANTON_TESTNET_LEDGER_TOKEN ?? "",
    "CantonStakeTestnetProvider::1220deef137801c81e0cfad972d4ca95467265ecf73eb311f67d205f8ecf23549b8f", { eventFormat: true });
  const legacy = new CantonClient(endpoint.toString(), old.CANTON_AUTH_TOKEN ?? "", old.CANTON_APP_PROVIDER_PARTY);
  const ledger = new CantonCutoverClient(primary, legacy);
  const healthResponse = await fetch("http://127.0.0.1:4002/api/health", { redirect: "error", signal: AbortSignal.timeout(10_000) });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json() as { networkMode: string; cantonJsonApi: string };
  assert.equal(health.networkMode, "testnet");
  assert.equal(health.cantonJsonApi, old.CANTON_JSON_API_URL);
  // Match the existing Compose TestNet database; no URL/credentials are logged.
  const db = new PrismaClient({ datasources: { db: { url: "postgresql://cantonstake:cantonstake@127.0.0.1:5434/cantonstake?connection_limit=1&connect_timeout=5" } }, log: [] });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const app = Fastify({ logger: false });
      await app.register(accountRewardRoutesFor({ ledger, db: tx, template: "#cantonstake:CantonStake.Staking:StakingPosition",
        networkMode: "testnet", loopStakingEnabled: true }));
      try {
        const response = await app.inject({ method: "POST", url: "/api/account/rewards",
          payload: { addresses: [address, address], clientNetworkMode: "testnet", days: 30, includeRounds: true } });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["cache-control"], "no-store");
        const result = response.json();
        assert.deepEqual(result.addresses, [normalizeWalletAddress(address)]);
        assert.equal(result.networkMode, "testnet");
        assert.equal(result.days, 30);
        assert.ok(Array.isArray(result.positions), "Real ledger and mirror position reads failed");
        assert.ok(Array.isArray(result.history?.events), "Real recorded-history reads failed");
        assert.ok(Array.isArray(result.rounds), "Real recorded-round reads failed");
        const stored = await tx.stakingPosition.findMany({ where: { evmAddress: normalizeWalletAddress(address) }, select: { contractId: true } });
        assert.ok(result.positions.every((row: any) => row.ledgerOrigin === "legacy" &&
          normalizeWalletAddress(row.argument.evmAddress) === normalizeWalletAddress(address) && stored.some(record => record.contractId === row.contractId)));
        const live = await fetch(`http://127.0.0.1:4002/api/positions?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10_000) });
        assert.equal(live.status, 200);
        const deployed = await live.json() as { positions: Array<{ contractId: string }> };
        assert.deepEqual(result.positions.map((row: any) => row.contractId).sort(), deployed.positions.map(row => row.contractId).sort());
        assert.deepEqual(result.policy, { ccPayments: "disabled", beneficiarySplit: "not_configured" });
        const mismatch = await app.inject({ method: "POST", url: "/api/account/rewards",
          payload: { addresses: [address], clientNetworkMode: "mainnet" } });
        assert.equal(mismatch.statusCode, 409);
        const invalid = await app.inject({ method: "POST", url: "/api/account/rewards",
          payload: { addresses: ["not-an-address"], clientNetworkMode: "testnet" } });
        assert.equal(invalid.statusCode, 400);
        const unscoped = await app.inject({ method: "POST", url: "/api/account/rewards",
          payload: { addresses: [], clientNetworkMode: "testnet" } });
        assert.equal(unscoped.statusCode, 400);
        console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0, databaseReadOnlyEnforced: true,
          positions: result.positions.length, historyEvents: result.history.events.length, rounds: result.rounds.length,
          legacyPositionCoverageMatchesDeployedApi: true, duplicateWalletsDeduplicated: true, wrongNetworkRejected: true,
          invalidAndMissingWalletScopeRejected: true, stagedLoopPaymentsDisabled: true,
          deployed: false, loopWalletRoundTripVerified: false }, null, 2));
      } finally { await app.close(); }
    }, { maxWait: 5000, timeout: 30000 });
  } finally { await db.$disconnect(); }
}

main().catch(() => {
  console.error("Read-only account rewards verification failed; inspect the TestNet DB, ledger reachability and source configuration locally. No writes were attempted.");
  process.exitCode = 1;
});
