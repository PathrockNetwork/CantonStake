import assert from "node:assert/strict";
import test from "node:test";
import { endpointList, retryableResponse, RpcPool, RpcUnavailable, upstreamUrl, type RpcRequest } from "../src/services/rpc-pool.js";
import { classifyRpcRequest, identityCheck, type RpcProtocol } from "../src/services/rpc-policy.js";

const endpoints = ["https://primary.example/rpc?key=private", "https://backup.example/rpc"];
const query: RpcRequest = { body: { jsonrpc: "2.0", id: 19, method: "eth_getBalance", params: ["0x1234", "0xa"] } };
const verifier = identityCheck({ protocol: "evm", chainId: "11155111" });
const json = (result: unknown, status = 200) => Response.json({ jsonrpc: "2.0", id: 19, result }, { status });
const isProbe = (init?: RequestInit) => JSON.parse(String(init?.body)).method === "eth_chainId";

test("dead primary switches reads to a verified backup, keeps exact parameters, and redacts secrets", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const pool = new RpcPool("settlement", endpoints, verifier, { fetch: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (String(url).includes("primary")) throw new Error("connection refused with private key");
    return json(isProbe(init) ? "0xaa36a7" : "0x55");
  } });
  assert.deepEqual((await pool.request(query, true)).body, { jsonrpc: "2.0", id: 19, result: "0x55" });
  assert.deepEqual(calls.at(-1)!.body, query.body);
  await pool.request(query, true);
  assert.equal(calls.filter((call) => call.url.includes("primary")).length, 1);
  assert.equal(pool.snapshot().activeEndpoint, 2);
  assert.equal(pool.snapshot().failovers, 1);
  assert.doesNotMatch(JSON.stringify(pool.snapshot()), /private|key=/);
});

test("wrong-network fallback never receives the real request", async () => {
  let businessCalls = 0;
  const pool = new RpcPool("settlement", endpoints, verifier, { fetch: async (url, init) => {
    if (!isProbe(init)) businessCalls++;
    if (String(url).includes("primary")) throw new Error("offline");
    return json("0x1");
  } });
  await assert.rejects(pool.request(query, true), RpcUnavailable);
  assert.equal(businessCalls, 0);
});

test("timeouts fail over and both-dead pools stop within a bounded budget", async () => {
  let calls = 0;
  const pool = new RpcPool("settlement", endpoints, verifier, { timeoutMs: 15, budgetMs: 100,
    fetch: async (_url, init) => { calls++; return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("test safety timer")), 1_000);
      init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("timeout")); }, { once: true });
    }); },
  });
  const started = Date.now();
  await assert.rejects(pool.request(query, true), RpcUnavailable);
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 500);
  await assert.rejects(pool.request(query, true), RpcUnavailable);
  assert.equal(calls, 2, "cooldown must prevent hammering unavailable providers");
});

test("primary is reconsidered after cooldown, with a fresh identity check", async () => {
  let now = 10_000;
  let primaryDown = true;
  let primaryProbes = 0;
  const pool = new RpcPool("settlement", endpoints, verifier, { now: () => now, cooldownMs: 50,
    fetch: async (url, init) => {
      if (String(url).includes("primary")) {
        if (isProbe(init)) primaryProbes++;
        if (primaryDown) throw new Error("offline");
      }
      return json(isProbe(init) ? "0xaa36a7" : "0x55");
    },
  });
  await pool.request(query, true);
  primaryDown = false;
  now += 51;
  assert.equal(pool.snapshot().endpoints[0]!.status, "retry_due", "elapsed cooldown is not proof of recovery");
  await pool.request(query, true);
  assert.equal(primaryProbes, 2);
  assert.equal(pool.snapshot().activeEndpoint, 1);
});

test("rate limits and provider failures fail over, contract reverts do not", async () => {
  for (const failure of [Response.json({ error: "busy" }, { status: 429 }), Response.json({ error: { code: -32005, message: "limit" } })]) {
    const pool = new RpcPool("settlement", endpoints, verifier, { fetch: async (url, init) =>
      isProbe(init) ? json("0xaa36a7") : String(url).includes("primary") ? failure : json("backup") });
    assert.equal((await pool.request(query, true)).body && pool.snapshot().activeEndpoint, 2);
  }
  let calls = 0;
  const pool = new RpcPool("settlement", endpoints, verifier, { fetch: async (_url, init) => {
    calls++;
    return isProbe(init) ? json("0xaa36a7") : Response.json({ error: { code: 3, message: "execution reverted" } });
  } });
  const response = await pool.request(query, true);
  assert.equal((response.body as any).error.code, 3);
  assert.equal(calls, 2);
});

test("writes can switch during preflight but are never replayed after dispatch", async () => {
  let submissions = 0;
  const pool = new RpcPool("settlement", endpoints, verifier, { fetch: async (url, init) => {
    if (isProbe(init)) {
      if (String(url).includes("primary")) throw new Error("offline before send");
      return json("0xaa36a7");
    }
    submissions++;
    throw new Error("connection lost after broadcast");
  } });
  await assert.rejects(pool.request({ body: { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["signed-by-user"] } }, false),
    (error: unknown) => error instanceof RpcUnavailable && error.ambiguousSubmission);
  assert.equal(submissions, 1);
});

test("identity validation is coalesced for concurrent requests and expires", async () => {
  let probes = 0;
  let now = 10_000;
  const pool = new RpcPool("settlement", [endpoints[0]!], verifier, { now: () => now, identityTtlMs: 10,
    fetch: async (_url, init) => { if (isProbe(init)) probes++; return json(isProbe(init) ? "0xaa36a7" : "0x55"); },
  });
  await Promise.all([pool.request(query, true), pool.request(query, true), pool.request(query, true)]);
  assert.equal(probes, 1);
  now += 11;
  await pool.request(query, true);
  assert.equal(probes, 2);
});

test("a slow submission has its own timeout but is still sent exactly once", async () => {
  let submissions = 0;
  const pool = new RpcPool("sui", endpoints, verifier, {
    timeoutMs: 5, budgetMs: 10, writeTimeoutMs: 200,
    fetch: async (_url, init) => {
      if (isProbe(init)) return json("0xaa36a7");
      submissions++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(json("submitted-hash")), 25);
        init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("submission timeout")); }, { once: true });
      });
    },
  });
  assert.equal((await pool.request({ body: { jsonrpc: "2.0", method: "eth_sendRawTransaction", params: ["signed"] } }, false)).status, 200);
  assert.equal(submissions, 1);
});

test("endpoint URL validation preserves pinned history and prevents target overrides", () => {
  assert.equal(upstreamUrl(endpoints[0]!, "/v1/view?ledger_version=123"), "https://primary.example/rpc/v1/view?key=private&ledger_version=123");
  for (const path of ["https://evil.example", "//evil.example", "/../secrets", "/%2e%2e/secrets", "/v1?key=replaced", "/foo\\bar"]) {
    assert.throws(() => upstreamUrl(endpoints[0]!, path));
  }
  assert.deepEqual(endpointList("https://a.example/", ["https://a.example", "https://b.example"]), ["https://a.example", "https://b.example"]);
  assert.throws(() => endpointList("file:///secret", []));
  assert.throws(() => endpointList("https://user:password@a.example", []));
});

test("all supported protocol probes reject wrong identities before dispatch", async () => {
  const cases: Array<[RpcProtocol, string, unknown]> = [
    ["evm", "97", { result: "0x61" }],
    ["cosmos", "provider", { result: { node_info: { network: "provider" }, sync_info: { catching_up: false } } }],
    ["cosmos-rest", "provider", { default_node_info: { network: "provider" } }],
    ["aptos", "2", { chain_id: 2 }],
    ["aptos-indexer", "2", { data: { ledger_infos: [{ chain_id: 2 }] } }],
    ["sui", "sui-genesis", { data: { chainIdentifier: "sui-genesis" } }],
    ["polkadot", "asset-hub-genesis", { result: "asset-hub-genesis" }],
    ["solana", "solana-genesis", { result: "solana-genesis" }],
  ];
  for (const [protocol, chainId, body] of cases) {
    await identityCheck({ protocol, chainId })(async () => ({ status: 200, body, headers: {} }));
    await assert.rejects(identityCheck({ protocol, chainId: "wrong" })(async () => ({ status: 200, body, headers: {} })));
  }
});

test("protocol policy distinguishes reads from broadcasts and rejects signing/admin calls", () => {
  for (const [protocol, read, write] of [
    ["evm", "eth_getLogs", "eth_sendRawTransaction"], ["cosmos", "abci_query", "broadcast_tx_sync"],
    ["solana", "getSignatureStatuses", "sendTransaction"], ["polkadot", "state_getMetadata", "author_submitExtrinsic"],
  ] as const) {
    assert.equal(classifyRpcRequest(protocol, { body: { jsonrpc: "2.0", method: read } }), true);
    assert.equal(classifyRpcRequest(protocol, { body: { jsonrpc: "2.0", method: write } }), false);
    assert.throws(() => classifyRpcRequest(protocol, { body: { jsonrpc: "2.0", method: "personal_unlockAccount" } }));
  }
  assert.equal(classifyRpcRequest("aptos", { path: "/v1/view?ledger_version=123", method: "POST" }), true);
  assert.equal(classifyRpcRequest("aptos", { path: "/v1/transactions", method: "POST" }), false);
  assert.equal(classifyRpcRequest("cosmos", { path: "/broadcast_tx_sync?tx=abc", method: "GET" }), false);
  assert.equal(classifyRpcRequest("cosmos-rest", { path: "/cosmos/tx/v1beta1/txs", method: "POST" }), false);
  assert.equal(classifyRpcRequest("sui", { body: { query: "query { chainIdentifier }" } }), true);
  assert.equal(classifyRpcRequest("sui", { body: { query: "# not a query\n mutation { executeTransaction { __typename } }" } }), false);
  assert.throws(() => classifyRpcRequest("aptos-indexer", { body: { query: "mutation { delete_ledger_infos { affected_rows } }" } }));
  assert.throws(() => classifyRpcRequest("sui", { body: { query: "query A { chainIdentifier } mutation B { executeTransaction { __typename } }" } }));
  assert.throws(() => classifyRpcRequest("evm", { body: [{ jsonrpc: "2.0", method: "eth_sendRawTransaction" }] }));
});

test("semantic errors and missing accounts are preserved, not mislabeled as outages", () => {
  for (const [status, body] of [[404, { error_code: "account_not_found" }], [410, { error_code: "version_pruned" }],
    [200, { error: { code: -32000, message: "insufficient funds" } }], [200, { errors: [{ message: "Unknown field on Query" }] }]] as const) {
    assert.equal(retryableResponse({ status, body, headers: {} }), false);
  }
  assert.equal(retryableResponse({ status: 200, body: { errors: [{ message: "Internal error", extensions: { code: "INTERNAL_SERVER_ERROR" } }] }, headers: {} }), true);
});
