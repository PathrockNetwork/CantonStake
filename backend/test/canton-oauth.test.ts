import assert from "node:assert/strict";
import test from "node:test";
import { clientCredentialsTokenSource } from "../src/services/canton-oauth.js";
import { CantonClient } from "../src/services/canton-ledger-client.js";

const creds = { tokenUrl: "https://tenant.example/oauth/token", clientId: "client", clientSecret: "secret",
  audience: "https://canton.network.global", scope: "daml_ledger_api" };

test("client-credentials source caches until shortly before expiry and shares one request", async () => {
  let clock = 0, calls = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(url, creds.tokenUrl);
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { grant_type: "client_credentials", client_id: "client",
      client_secret: "secret", audience: creds.audience, scope: "daml_ledger_api" });
    return Response.json({ access_token: `token-${calls}`, expires_in: 86400 });
  }) as typeof fetch;
  const source = clientCredentialsTokenSource(creds, fetchImpl, () => clock);
  assert.deepEqual(await Promise.all([source(), source()]), ["token-1", "token-1"]);
  assert.equal(calls, 1);
  clock = 86400_000 - 5 * 60_000 - 1;
  assert.equal(await source(), "token-1");
  clock += 2;
  assert.equal(await source(), "token-2");
});

test("token failures and malformed responses never leak the response body", async () => {
  const failing = clientCredentialsTokenSource(creds, (async () =>
    new Response("client_secret=secret is wrong", { status: 401 })) as typeof fetch);
  await assert.rejects(failing(), (error: Error) => error.message === "Canton OAuth token request failed (401)");
  const malformed = clientCredentialsTokenSource(creds, (async () => Response.json({ access_token: "a b", expires_in: 60 })) as typeof fetch);
  await assert.rejects(malformed(), /malformed/);
});

test("rejects non-HTTPS token endpoints and missing credentials", () => {
  assert.throws(() => clientCredentialsTokenSource({ ...creds, tokenUrl: "http://tenant.example/oauth/token" }), /HTTPS/);
  assert.throws(() => clientCredentialsTokenSource({ ...creds, clientSecret: "" }), /client secret/);
});

test("ledger client sends the renewed bearer from a token source", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fresh");
      return Response.json({ offset: 5 });
    };
    await new CantonClient("https://ledger.example/api/json-api", async () => "fresh", "provider").probe();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
