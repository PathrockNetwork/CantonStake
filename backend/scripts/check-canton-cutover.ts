/** Real, read-only cutover inventory. No mock wallet, ledger commands or DB writes. */
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { CantonClient } from "../src/services/canton-ledger-client.js";
import { CantonCutoverClient } from "../src/services/canton-cutover-client.js";

async function main() {
  // Read existing LocalNet credentials in memory; never print/export them or
  // load a primary participant token as a legacy token.
  const old = parse(await readFile(new URL("../../.env", import.meta.url)));
  const endpoint = new URL(old.CANTON_JSON_API_URL || "http://localhost:3975");
  if (!["localhost", "127.0.0.1", "host.docker.internal"].includes(endpoint.hostname)) {
    throw new Error("This inventory expects the explicitly existing LocalNet endpoint");
  }
  if (endpoint.hostname === "host.docker.internal") endpoint.hostname = "127.0.0.1"; // Run on the app host, not inside Docker.
  const legacyParty = old.CANTON_APP_PROVIDER_PARTY;
  if (!legacyParty) throw new Error("Pre-cutover provider configuration is missing");
  const remoteParty = "CantonStakeTestnetProvider::1220deef137801c81e0cfad972d4ca95467265ecf73eb311f67d205f8ecf23549b8f";
  const primary = new CantonClient("https://api.canton.cttestnet.pathrocknetwork.org/api/json-api",
    process.env.CANTON_TESTNET_LEDGER_TOKEN ?? "", remoteParty, { eventFormat: true });
  const legacy = new CantonClient(endpoint.toString(), old.CANTON_AUTH_TOKEN ?? "", legacyParty);
  const router = new CantonCutoverClient(primary, legacy);
  const [positions, requests, response, healthResponse] = await Promise.all([
    router.activeContracts("#cantonstake:CantonStake.Staking:StakingPosition", AbortSignal.timeout(10000)),
    router.activeContracts("#cantonstake:CantonStake.Staking:StakingRequest", AbortSignal.timeout(10000)),
    fetch("http://127.0.0.1:4002/api/positions", { redirect: "error", signal: AbortSignal.timeout(10000) }),
    fetch("http://127.0.0.1:4002/api/health", { redirect: "error", signal: AbortSignal.timeout(10000) }),
  ]);
  if (!response.ok) throw new Error(`Current TestNet positions unavailable (${response.status})`);
  if (!healthResponse.ok) throw new Error("Current TestNet backend health is unavailable");
  const health = await healthResponse.json() as { networkMode?: string; cantonJsonApi?: string };
  if (health.networkMode !== "testnet" || health.cantonJsonApi !== old.CANTON_JSON_API_URL) {
    throw new Error("Inventory target does not match the actual pre-cutover TestNet backend");
  }
  const result = await response.json() as { positions: Array<{ contractId: string }> };
  if (!Array.isArray(result.positions)) throw new Error("Current TestNet position response is invalid");
  const covered = result.positions.every(row => positions.some(contract => contract.contractId === row.contractId && contract.ledgerOrigin === "legacy"));
  const originsMatch = positions.every(row => row.argument.appProvider === (row.ledgerOrigin === "legacy" ? legacyParty : remoteParty)) &&
    requests.every(row => row.argument.appProvider === (row.ledgerOrigin === "legacy" ? legacyParty : remoteParty));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), writesPerformed: 0,
    primaryPositions: positions.filter(row => row.ledgerOrigin === "primary").length,
    legacyPositions: positions.filter(row => row.ledgerOrigin === "legacy").length,
    primaryRequests: requests.filter(row => row.ledgerOrigin === "primary").length,
    legacyRequests: requests.filter(row => row.ledgerOrigin === "legacy").length,
    deploymentPositions: result.positions.length, deploymentPositionsCoveredByLegacy: covered, originsMatch,
    configuredForProduction: false, writeRoutingVerified: false, loopWalletRoundTripVerified: false,
  }, null, 2));
  if (!covered || !originsMatch) process.exitCode = 1;
}

main().catch(() => {
  // Never dump arbitrary upstream error bodies or credential-bearing URLs.
  console.error("Read-only cutover inventory failed; inspect endpoint reachability and credential configuration locally.");
  process.exitCode = 1;
});
