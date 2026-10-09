import { describe, expect, it } from "vitest";
import { nativeAvailability, poolAvailability, type HomeReadiness } from "../home-networks";
const now = Date.now();
function ready() {
  return { id: "cosmos", configured: true, adapter: true, mode: "testnet", externalLoop: false, now,
    readiness: { updatedAt: now, data: { status: "ready", canton: "reachable", networkMode: "testnet", time: new Date(now).toISOString() } as HomeReadiness },
    watchers: { updatedAt: now, data: { networkMode: "testnet", watchers: [{ chain: "cosmos", status: "ok", lastSuccessAt: new Date(now).toISOString() }] } },
    catalog: { updatedAt: now, data: { chains: [{ chain: "cosmos" }] } },
  };
}
describe("homepage native staking availability", () => {
  it("requires more than configuration to claim availability", () => {
    expect(nativeAvailability({ ...ready(), readiness: {} }).label).toBe("Checking");
    expect(nativeAvailability({ ...ready(), configured: false }).label).toBe("Not enabled");
    expect(nativeAvailability(ready()).label).toBe("Available");
  });
  it("does not keep green status after a failed refresh or stale data", () => {
    const input = ready();
    expect(nativeAvailability({ ...input, watchers: { ...input.watchers, failed: true } }).label).toBe("Status unavailable");
    expect(nativeAvailability({ ...input, now: now + 90001 }).label).toBe("Status unavailable");
    input.readiness.data.time = new Date(now - 90001).toISOString();
    expect(nativeAvailability(input).label).toBe("Status unavailable");
  });
  it("rejects mismatched deployment modes", () => {
    const input = ready(); input.watchers.data.networkMode = "mainnet";
    expect(nativeAvailability(input).label).toBe("Status unavailable");
  });
  it("honors missing backend configuration", () => {
    const input = ready(); input.catalog.data.chains = [];
    expect(nativeAvailability(input).label).toBe("Not enabled");
  });
  it("blocks unavailable Canton and unhealthy or stale confirmation watchers", () => {
    const input = ready(); input.readiness.data.canton = "unreachable";
    expect(nativeAvailability(input).tone).toBe("unavailable");
    input.readiness.data.canton = "reachable";
    input.watchers.data.watchers[0].status = "error";
    expect(nativeAvailability(input).tone).toBe("unavailable");
    input.watchers.data.watchers[0].status = "ok";
    input.watchers.data.watchers[0].lastSuccessAt = new Date(now - 180001).toISOString();
    expect(nativeAvailability(input).tone).toBe("unavailable");
  });
  it("uses per-network readiness when the backend provides it", () => {
    const input = ready(); input.readiness.data.nativeStaking = [{ chain: "cosmos", reason: "blocked" }];
    expect(nativeAvailability(input).tone).toBe("unavailable");
    input.readiness.data.nativeStaking[0].reason = null;
    expect(nativeAvailability(input).tone).toBe("ready");
  });
  it("requires external Loop only for deployments that use that flow", () => {
    const input = ready(); input.readiness.data.loopStaking = { status: "blocked", supportedChains: [] };
    expect(nativeAvailability(input).tone).toBe("ready");
    input.externalLoop = true;
    expect(nativeAvailability(input).tone).toBe("unavailable");
    input.readiness.data.loopStaking = { status: "ready", supportedChains: ["cosmos"] };
    expect(nativeAvailability(input).tone).toBe("ready");
  });
});
describe("independent pools", () => {
  it("uses the pool's own deposit status", () => {
    expect(poolAvailability({ updatedAt: now, data: { paused: false, available: true } }, now).label).toBe("Pool available");
    expect(poolAvailability({ updatedAt: now, data: { paused: true, available: true } }, now).tone).toBe("unavailable");
    expect(poolAvailability({ updatedAt: now, data: { paused: false, available: false } }, now).tone).toBe("unavailable");
  });
  it("does not advertise deposits on failed, absent, or stale reads", () => {
    expect(poolAvailability({}, now).label).toBe("Checking");
    expect(poolAvailability({ failed: true }, now).label).toBe("Status unavailable");
    expect(poolAvailability({ updatedAt: now - 90001, data: { paused: false, available: true } }, now).tone).toBe("unavailable");
  });
});
