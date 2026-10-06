import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.CANTON_APP_PROVIDER_PARTY = "test-provider";
process.env.CANTON_DELEGATOR_PARTY = "test-delegator";
process.env.NETWORK_MODE = "testnet";
const services = await import("../src/services/polygon-liquid.js");
const { polygonLiquidRoutesFor } = await import("../src/routes/polygon-liquid.js");
const router = "0x0000000000000000000000000000000000000011";
const wrapper = "0x0000000000000000000000000000000000000022";
const pool = "0x0000000000000000000000000000000000000033";
const factory = "0x0000000000000000000000000000000000000044";
const wallet = "0x0000000000000000000000000000000000000055";

async function fixture(options: { disabled?: boolean; paused?: boolean; empty?: boolean; wrongPool?: boolean; wrongFactory?: boolean; impact?: boolean } = {}) {
  const reads: any[] = [];
  const client = {
    getBlock: async () => ({ number: 42n, timestamp: 100n }), getBlockNumber: async () => 42n,
    getBalance: async (args: unknown) => { reads.push(args); return 123n; },
    readContract: async (args: any) => {
      reads.push(args);
      const values: Record<string, unknown> = {
        paused: options.paused ?? false, lastExchangeRateUpdate: 99n, maxExchangeRateUpdateDelay: 10n, safetyFee: 100,
        balanceOf: 456n, token0: services.SPOL, token1: wrapper, liquidity: options.empty ? 0n : 10000n,
        fee: 100, slot0: [1n << 96n, 0, 0, 0, 0, 0, true], factory: options.wrongFactory && args.address === router ? pool : factory,
        WETH9: wrapper, getPool: options.wrongPool ? wrapper : pool, convertPOLToSPOL: 9900n,
      };
      if (!(args.functionName in values)) throw Error("Unexpected read");
      return values[args.functionName];
    },
    simulateContract: async (args: unknown) => { reads.push(args); return { result: options.impact ? 9400n : 9900n }; },
  };
  const app = Fastify();
  await app.register(polygonLiquidRoutesFor({ ...services,
    liquidClient: client as unknown as typeof services.liquidClient,
    liquidEnabled: () => !options.disabled, assertLiquidChain: async () => {},
    liquidFixture: () => ({ router, wrapper, pool, quoter: factory }),
    liquidLedgerBalance: async () => null,
    startLiquidTracking: () => () => {},
  }, { user: { findUnique: async () => null } } as never));
  return { app, reads };
}

test("liquid route binds wallet balances and uses one block", async () => {
  const { app, reads } = await fixture();
  try {
    const response = await app.inject(`/api/polygon/liquid?wallet=${wallet}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.json().wallet, wallet);
    assert.equal(response.json().nativeBalance, "123");
    assert.equal(response.json().sharesBalance, "456");
    assert.equal(response.json().ccRewardsEnabled, false);
    // 456 shares at 9,900 sPOL per 1e18 POL.
    assert.equal(response.json().polValue, String(456n * 10n ** 18n / 9900n));
    assert(reads.every(read => read.blockNumber === 42n));
    const disconnected = (await app.inject("/api/polygon/liquid")).json();
    assert.equal(disconnected.wallet, null);
    assert.equal(disconnected.nativeBalance, null);
  } finally { await app.close(); }
});
test("liquid quote binds its contracts and uses one snapshot", async () => {
  const { app, reads } = await fixture();
  try {
    const response = await app.inject("/api/polygon/liquid/quote?direction=exit&amount=10000");
    assert.equal(response.statusCode, 200);
    const quote = response.json();
    assert.equal(quote.chainId, 80002); assert.equal(quote.testOnly, true);
    assert.equal(quote.router, router); assert.equal(quote.pool, pool); assert.equal(quote.token, services.SPOL);
    assert.equal(quote.priceImpactBps, 100); assert.equal(quote.minimumOut, "9801");
    assert(reads.every(read => read.blockNumber === 42n));
  } finally { await app.close(); }
});
test("liquid exits fail closed for empty, mismatched and excessive-impact pools", async () => {
  for (const options of [{ empty: true }, { wrongPool: true }, { wrongFactory: true }, { impact: true }]) {
    const { app } = await fixture(options);
    try { assert.equal((await app.inject("/api/polygon/liquid/quote?direction=exit&amount=10000")).statusCode, 503); }
    finally { await app.close(); }
  }
});
test("disabled route and paused deposits cannot produce executable quotes", async () => {
  for (const options of [{ disabled: true }, { paused: true }]) {
    const { app } = await fixture(options);
    try { assert.equal((await app.inject("/api/polygon/liquid/quote?direction=deposit&amount=10000")).statusCode, options.disabled ? 404 : 503); }
    finally { await app.close(); }
  }
});
