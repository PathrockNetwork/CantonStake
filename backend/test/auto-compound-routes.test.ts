import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import autoCompoundRoutes from "../src/routes/auto-compound.js";

test("disabled and unverified deployments expose availability and reject writes before any side effects", async () => {
  for (const disabled of [true, false]) {
    let creates = 0;
    let triggers = 0;
    const app = Fastify();
    await app.register(autoCompoundRoutes, {
      disabled,
      db: { autoCompoundPermit: { create: async () => { creates++; } } } as any,
      trigger: async () => { triggers++; },
    });
    try {
      const status = await app.inject("/api/autocompound/status");
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().status, disabled ? "disabled" : "unavailable");
      assert.equal(status.json().executionEnabled, false);
      assert.deepEqual(status.json().supportedChains, []);
      assert.ok(["testnet", "mainnet"].includes(status.json().networkMode));

      const creation = await app.inject({ method: "POST", url: "/api/autocompound/permits", payload: {
        userId: "owner", chain: "polygon", validator: "0xvalidator", signature: "0xunverified",
        expiresAt: "2099-01-01T00:00:00Z",
      } });
      assert.equal(creation.statusCode, 403);
      assert.equal(creation.json().status, status.json().status);
      assert.equal((await app.inject({ method: "POST", url: "/api/autocompound/trigger" })).statusCode, 403);
      assert.equal(creates, 0);
      assert.equal(triggers, 0);
    } finally { await app.close(); }
  }
});

test("disabled automation keeps permit history readable and revocation available", async () => {
  const calls: unknown[] = [];
  const permit = { id: "saved", userId: "owner", enabled: true };
  const app = Fastify();
  await app.register(autoCompoundRoutes, {
    disabled: true,
    db: {
      autoCompoundPermit: {
        findMany: async (query: unknown) => { calls.push(query); return [permit]; },
        update: async (query: unknown) => { calls.push(query); return { ...permit, enabled: false }; },
      },
      autoCompoundRun: { findMany: async (query: unknown) => { calls.push(query); return [{ id: "previous-run" }]; } },
    } as any,
  });
  try {
    assert.equal((await app.inject("/api/autocompound/permits")).statusCode, 400);
    const list = await app.inject("/api/autocompound/permits?userId=owner");
    assert.deepEqual(list.json().permits, [permit]);
    assert.deepEqual(calls[0], { where: { userId: "owner" }, orderBy: { createdAt: "desc" } });
    const revoke = await app.inject({ method: "DELETE", url: "/api/autocompound/permits/saved" });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().permit.enabled, false);
    assert.deepEqual(calls[1], { where: { id: "saved" }, data: { enabled: false } });
    assert.equal((await app.inject("/api/autocompound/permits/saved/runs")).json().runs[0].id, "previous-run");
  } finally { await app.close(); }
});
