import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCantonReadiness } from "../api";
import { networkMode } from "../network";

afterEach(() => vi.unstubAllGlobals());
function response(status: number, body: object) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}
const ready = { status: "ready", canton: "reachable", networkMode, time: "2026-09-26T00:00:00Z" };

describe("Canton readiness API", () => {
  it("accepts a same-mode ready response and a well-formed unavailable response", async () => {
    response(200, ready);
    expect((await fetchCantonReadiness()).status).toBe("ready");
    response(503, { ...ready, status: "unavailable", canton: "unreachable" });
    expect((await fetchCantonReadiness()).status).toBe("unavailable");
  });
  it("rejects wrong-mode readiness", async () => {
    response(200, { ...ready, networkMode: networkMode === "testnet" ? "mainnet" : "testnet" });
    await expect(fetchCantonReadiness()).rejects.toThrow("network mode");
  });
  it("does not accept cached ready data carried by an error HTTP status or malformed data", async () => {
    response(503, ready);
    await expect(fetchCantonReadiness()).rejects.toThrow("Invalid");
    response(200, { networkMode });
    await expect(fetchCantonReadiness()).rejects.toThrow("Invalid");
    response(500, ready);
    await expect(fetchCantonReadiness()).rejects.toThrow("HTTP 500");
  });
});
