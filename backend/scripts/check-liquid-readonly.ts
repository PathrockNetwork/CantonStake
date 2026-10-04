/** Read-only smoke test of the real Amoy route; no listener, signer or ledger writes. */
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createPublicClient, http } from "viem";

process.env.NETWORK_MODE = "testnet";
process.env.SPOL_TEST_ENABLED = "true";
process.env.CANTON_APP_PROVIDER_PARTY = "readonly-smoke-provider";
process.env.CANTON_DELEGATOR_PARTY = "readonly-smoke-delegator";
process.env.AMOY_RPC_URL = "https://polygon-amoy-bor-rpc.publicnode.com";
process.env.SPOL_TEST_ROUTER = "0x2179F58DFfEb0B64F19F7bA568c54A39fd6183C6";
process.env.SPOL_TEST_QUOTER = "0xFAa862C54004832997C5141Bb7eE91510E49Af3F";
process.env.SPOL_TEST_WRAPPER = "0x465572dE80c3B7F7b99158B169F29Aa87D39268E";
process.env.SPOL_TEST_POOL = "0xeE0dC3E9abC99330419aF9C082629D9a40712dC0";

const services = await import("../src/services/polygon-liquid.js");
const { polygonLiquidRoutesFor } = await import("../src/routes/polygon-liquid.js");
const app = Fastify();
// The normal client calls the backend's localhost RPC gateway. This isolated
// inject-only server deliberately has no listener, so use the deployed read gateway.
const client = createPublicClient({ transport: http("https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon", { timeout: 15000, retryCount: 0 }) });
await app.register(polygonLiquidRoutesFor({ ...services,
  liquidClient: client,
  assertLiquidChain: async () => { assert.equal(await client.getChainId(), 80002); },
  startLiquidTracking: () => () => {},
  liquidLedgerBalance: async () => null,
  syncLiquidWallet: async () => { throw Error("Writes are prohibited in this check"); },
}));
try {
  const stateResponse = await app.inject("/api/polygon/liquid");
  assert.equal(stateResponse.statusCode, 200, stateResponse.body);
  const state = stateResponse.json();
  assert.equal(state.chainId, 80002); assert.equal(state.testOnly, true);
  assert.equal(state.wallet, null); assert.equal(state.ccRewardsEnabled, false);
  const depositResponse = await app.inject("/api/polygon/liquid/quote?direction=deposit&amount=1000000000000000");
  assert.equal(depositResponse.statusCode, 200, depositResponse.body);
  const deposit = depositResponse.json();
  const exitResponse = await app.inject(`/api/polygon/liquid/quote?direction=exit&amount=${deposit.amountOut}`);
  assert.equal(exitResponse.statusCode, 200, exitResponse.body);
  const exit = exitResponse.json();
  assert(BigInt(exit.amountOut) > 0n); assert(exit.priceImpactBps <= 500);
  console.log(JSON.stringify({ status: "PASS", scope: "READ-ONLY quotes against deployed Amoy contracts, not a submitted round trip",
    block: state.block, paused: state.paused, rateFresh: state.rateFresh, safetyFeeBps: state.safetyFeeBps,
    depositPOLBaseUnits: deposit.amountIn, quotedSharesBaseUnits: deposit.amountOut,
    quotedReturnPOLBaseUnits: exit.amountOut, exitPriceImpactBps: exit.priceImpactBps,
    publicTransactions: 0, cantonWrites: 0 }));
} finally { await app.close(); }
