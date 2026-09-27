import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAutoCompoundStatus } from "../api";
import { networkMode } from "../network";

afterEach(() => vi.unstubAllGlobals());
const disabled = { status: "disabled", executionEnabled: false, supportedChains: [], reason: "Disabled", networkMode };

describe("auto-compound availability", () => {
  it("reads deployment status without deriving execution from saved permits", async () => {
    const fetchMock = vi.fn(async () => Response.json(disabled));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAutoCompoundStatus()).toEqual(disabled);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/autocompound\/status$/));
  });

  it("rejects a response from the other deployment mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...disabled, networkMode: networkMode === "mainnet" ? "testnet" : "mainnet" })));
    await expect(fetchAutoCompoundStatus()).rejects.toThrow(/network does not match/);
  });

  it("fails closed for unavailable or contradictory status responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    await expect(fetchAutoCompoundStatus()).rejects.toThrow(/unavailable/);
    for (const body of [
      { ...disabled, executionEnabled: true },
      { ...disabled, status: "ready" },
      { ...disabled, status: "ready", executionEnabled: true },
      { ...disabled, supportedChains: [1] },
      { ...disabled, status: "armed" },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
      await expect(fetchAutoCompoundStatus()).rejects.toThrow(/invalid/);
    }
  });
});
