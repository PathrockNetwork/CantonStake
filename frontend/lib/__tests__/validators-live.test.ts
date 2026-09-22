import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchScoredValidators } from "../validators-live";

afterEach(() => vi.unstubAllGlobals());
describe("eligible Polygon validators", () => {
  it("does not offer sample validators when the live feed is unavailable or empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await fetchScoredValidators("polygon")).rows).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ source: "live", validators: [] }) }));
    expect((await fetchScoredValidators("polygon")).rows).toEqual([]);
  });
  it("keeps actual commission separate from unavailable APR and excludes jailed validators", async () => {
    const validator = { address: "0x1111111111111111111111111111111111111111", name: "Validator", commissionPct: 5, uptimePct: 99.9, jailed: false, score: 95, totalStaked: 100, stakeSharePct: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ source: "live", validators: [validator, { ...validator, jailed: true }] }) }));
    const { rows } = await fetchScoredValidators("polygon");
    expect(rows).toHaveLength(1);
    expect(rows[0].commission).toBe(5);
    expect(rows[0].apr).toBe(0);
  });
});
