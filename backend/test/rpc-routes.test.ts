import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import rpcRoutes from "../src/routes/rpc.js";
import { config } from "../src/config.js";
import { parseRpcBackups, rpcDefinitions } from "../src/services/rpc-registry.js";

test("gateway rejects wrong mode, unknown pools, signing calls and unsafe paths before contacting any upstream", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
  const app = Fastify();
  await app.register(rpcRoutes);
  const base = `/api/rpc/${config.networkMode}/monad`;
  try {
    const mode = config.networkMode === "testnet" ? "mainnet" : "testnet";
    assert.equal((await app.inject({ method: "POST", url: `/api/rpc/${mode}/monad`, payload: {} })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: `/api/rpc/${config.networkMode}/unknown`, payload: {} })).statusCode, 404);
    for (const method of ["personal_sign", "eth_sendTransaction", "admin_nodeInfo"]) {
      assert.equal((await app.inject({ method: "POST", url: base, payload: { jsonrpc: "2.0", id: 1, method } })).statusCode, 400);
    }
    assert.equal(calls, 0);
    const status = await app.inject("/api/rpc/status");
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().networkMode, config.networkMode);
    assert.equal(status.json().pools.length, 15);
    assert.equal(status.headers["cache-control"], "no-store");
    assert.equal(status.json().pools.find((p: any) => p.pool === "sui").redundancy, false);
    assert.doesNotMatch(status.body, /https:\/\/|key=/);
  } finally { globalThis.fetch = original; await app.close(); }
});

test("gateway supports SDK base URLs and wildcard paths, preserves ledger versions and drops client credentials", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: any; headers?: HeadersInit }> = [];
  const chainId = config.networkMode === "mainnet" ? 1 : 2;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: init?.headers });
    if (body?.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 1, result: config.networkMode === "mainnet" ? "0x8f" : "0x279f" });
    if (body?.method) return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x55" });
    if (url.endsWith("/v1")) return Response.json({ chain_id: chainId });
    return Response.json(["12"], { headers: { "x-aptos-ledger-version": "123" } });
  };
  const app = Fastify();
  await app.register(rpcRoutes);
  try {
    for (const suffix of ["", "/"]) {
      const res = await app.inject({ method: "POST", url: `/api/rpc/${config.networkMode}/monad${suffix}`,
        headers: { authorization: "Bearer browser-secret", cookie: "private-cookie" },
        payload: { jsonrpc: "2.0", id: 42, method: "eth_blockNumber" } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().id, 42);
    }
    const response = await app.inject({ method: "POST", url: `/api/rpc/${config.networkMode}/aptos/v1/view?ledger_version=123`,
      payload: { function: "0x1::delegation_pool::get_stake", arguments: ["0x1"], type_arguments: [] } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), ["12"]);
    assert.equal(response.headers["x-aptos-ledger-version"], "123");
    assert.match(calls.at(-1)!.url, /\/v1\/view\?ledger_version=123$/);
    assert.doesNotMatch(JSON.stringify(calls), /browser-secret|private-cookie/);
  } finally { globalThis.fetch = original; await app.close(); }
});

test("fallback configuration validates service names and keeps all identities mode-specific", () => {
  assert.deepEqual(parseRpcBackups('{"sui":["https://backup.example/graphql"]}'), { sui: ["https://backup.example/graphql"] });
  for (const raw of ["oops", "[]", "null", '{"typo":[]}', '{"sui":"https://backup.example"}']) {
    assert.throws(() => parseRpcBackups(raw));
  }
  assert.equal(rpcDefinitions.settlement.chainId, config.networkMode === "mainnet" ? "1" : "11155111");
  assert.equal(rpcDefinitions.polygon.chainId, config.networkMode === "mainnet" ? "137" : "80002");
  assert.equal(rpcDefinitions.aptos.chainId, config.networkMode === "mainnet" ? "1" : "2");
  assert.equal(rpcDefinitions.cosmos.chainId, config.networkMode === "mainnet" ? "cosmoshub-4" : "provider");
  assert.equal(rpcDefinitions["aptos-indexer"].backups.length, config.networkMode === "mainnet" ? 1 : 0);
});

test("gateway preserves the installed Sui SDK protocol header without forwarding authorization", async () => {
  const original = globalThis.fetch;
  const headers: Headers[] = [];
  globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json({ data: { chainIdentifier: rpcDefinitions.sui.chainId } });
  };
  const app = Fastify();
  await app.register(rpcRoutes);
  try {
    const response = await app.inject({ method: "POST", url: `/api/rpc/${config.networkMode}/sui`,
      headers: { "x-sui-client-protocol-version": "999", authorization: "Bearer private" },
      payload: { query: "{ chainIdentifier }" } });
    assert.equal(response.statusCode, 200);
    assert.equal(headers.at(-1)!.get("x-sui-client-protocol-version"), "999");
    assert.ok(headers.every((item) => !item.has("authorization")));
  } finally { globalThis.fetch = original; await app.close(); }
});
