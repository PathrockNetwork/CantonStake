import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import readinessRoutes from "../src/routes/readiness.js";

test("readiness is green only after the authenticated Canton probe succeeds", async () => {
  const app = Fastify();
  await app.register(readinessRoutes, { probe: async (signal) => {
    assert.equal(signal.aborted, false);
  } });
  const response = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().canton, "reachable");
  await app.close();
});

test("readiness reports Canton failure without changing backend liveness", async () => {
  const app = Fastify({ logger: false });
  await app.register(readinessRoutes, { probe: async () => { throw new Error("ledger unavailable"); } });
  const response = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().canton, "unreachable");
  await app.close();
});
