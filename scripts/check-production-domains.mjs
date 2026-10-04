#!/usr/bin/env node
// Read-only deployment check. No wallet, bearer token, ledger submission,
// generated identity, database write, or substitute Loop environment.
import assert from "node:assert/strict";

const deployments = [
  { mode: "testnet", origin: "https://testnet.cantonstake.pathrocknetwork.org", settlement: 11155111 },
  { mode: "mainnet", origin: "https://cantonstake.pathrocknetwork.org", settlement: 1 },
];
const requestedMode = process.argv[2];
assert(!requestedMode || ["testnet", "mainnet"].includes(requestedMode), "Usage: node scripts/check-production-domains.mjs [testnet|mainnet]");

async function read(origin, path) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store",
  });
  assert.equal(response.status, 200, `${origin}${path}: HTTP ${response.status}`);
  return response;
}

let failed = false;
for (const { mode, origin, settlement } of deployments.filter(({ mode }) => !requestedMode || requestedMode === mode)) {
  try {
    const health = await (await read(origin, "/api/health")).json();
    assert.equal(health.status, "ok");
    assert.equal(health.networkMode, mode, "Public domain routed to the wrong backend mode");
    assert.equal(health.stakeSettlementChainId, settlement, "Polygon settlement network mismatch");

    const readiness = await (await read(origin, "/api/readiness")).json();
    assert.equal(readiness.networkMode, mode);
    assert.equal(readiness.status, "ready");
    assert.equal(readiness.canton, "reachable");
    assert.equal(readiness.loopStaking?.status, "blocked", "This rollout must not enable unapproved external signing");
    assert.equal(readiness.loopStaking.ccPaymentsEnabled, false);
    assert.equal(typeof readiness.loopStaking.reason, "string");
    assert(readiness.loopStaking.reason.length > 0);
    if (mode === "mainnet") assert.deepEqual(readiness.loopStaking.supportedChains, []);

    const optimizer = await fetch(origin + "/_next/image", {
      signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
    });
    assert.equal(optimizer.status, 404, "Unused image-optimization endpoint must remain disabled");
    await optimizer.arrayBuffer();

    const pages = [];
    for (const path of ["/", "/stake", "/positions", "/rewards", "/portfolio"]) {
      const response = await read(origin, path);
      assert(response.headers.get("content-type")?.includes("text/html"), `${path}: expected HTML`);
      assert(response.headers.get("cache-control")?.includes("no-store"), `${path}: stale documents must not be cached`);
      const html = await response.text();
      assert(html.includes("CantonStake"), `${path}: application page missing`);
      assert(!html.includes("PAUSE ANIMATION"), `${path}: removed demo animation control returned`);
      pages.push(path);
    }
    console.log(JSON.stringify({ mode, origin, status: "pass", pages, settlement,
      cantonReachable: true, externalLoopSigning: "blocked", ccPaymentsEnabled: false, imageOptimizer: "disabled",
      note: "Deployment/readiness checks only; not a signed or funded wallet round trip." }));
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({ mode, origin, status: "fail", error: error instanceof Error ? error.message : "Read failed" }));
  }
}
process.exitCode = failed ? 1 : 0;
