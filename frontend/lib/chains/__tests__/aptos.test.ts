import { beforeEach, describe, expect, it, vi } from "vitest";
import { APTOS_MAX_U64 } from "@/lib/aptos/network";

const pool = `0x${"b".repeat(64)}`;
const delegator = `0x${"a".repeat(64)}`;
const fetchValidatorScores = vi.fn();
vi.mock("@/lib/api", () => ({ fetchValidatorScores: (...args: unknown[]) => fetchValidatorScores(...args) }));

const { aptosAdapter } = await import("@/lib/chains/aptos");

beforeEach(() => {
  fetchValidatorScores.mockReset().mockResolvedValue({ validators: [{ address: pool, name: "Pool", commissionPct: 12, uptimePct: 99 }] });
});

describe("Aptos delegation-pool adapter", () => {
  it("rejects pool balances from an indexer on the wrong network", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {
        ledger_infos: [{ chain_id: 999 }],
        current_delegator_balances: [{ pool_address: pool }],
      } }) });
      await expect(aptosAdapter.getDelegations(delegator)).rejects.toThrow(/does not match/);
    } finally { globalThis.fetch = originalFetch; }
  });

  it("builds the native add_stake and unlock entry functions in octas", async () => {
    const args = { validator: pool, amount: 100_000_000n, delegator };
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ["0", "0", "0"] });
      expect(await aptosAdapter.buildDelegateTx(args)).toEqual({ kind: "aptos", function: "0x1::delegation_pool::add_stake", args: [pool, "100000000"] });
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ["99999990", "0", "0"] })
        .mockResolvedValueOnce({ ok: true, json: async () => ["10000000000", "0", "0", "0"] });
      expect(await aptosAdapter.buildUndelegateTx(args)).toEqual({ kind: "aptos", function: "0x1::delegation_pool::unlock", args: [pool, "99999990"] });
    } finally { globalThis.fetch = originalFetch; }
    expect((await aptosAdapter.getValidators())[0]).toMatchObject({ address: pool, commission: 12 });
    expect(fetchValidatorScores).toHaveBeenCalledWith("aptos");
  });

  it("withdraws only when the native pending-withdrawal view says ready", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [false, "100000000"] });
      await expect(aptosAdapter.buildClaimTx({ validator: pool, delegator })).rejects.toMatchObject({ code: "UNBONDING_PERIOD" });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [true, "100000000"] });
      expect(await aptosAdapter.buildClaimTx({ validator: pool, delegator })).toEqual({ kind: "aptos", function: "0x1::delegation_pool::withdraw", args: [pool, APTOS_MAX_U64.toString()] });
    } finally { globalThis.fetch = originalFetch; }
  });

  it("rejects adding an app position to pre-existing native stake in any state", async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const balances of [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]]) {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => balances });
        await expect(aptosAdapter.buildDelegateTx({ validator: pool, amount: 1_100_000_000n, delegator })).rejects.toThrow(/already has stake/);
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  it("unlocks all owned stake including compounded rewards, not just the original principal", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ["3000000000", "0", "0"] })
        .mockResolvedValueOnce({ ok: true, json: async () => ["10000000000", "0", "0", "0"] });
      expect(await aptosAdapter.buildUndelegateTx({ validator: pool, amount: 1_100_000_000n, delegator })).toMatchObject({ args: [pool, "3000000000"] });
    } finally { globalThis.fetch = originalFetch; }
  });

  it("waits for activation if the whole delegation cannot be unlocked yet", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ["1100000000", "0", "0"] })
        .mockResolvedValueOnce({ ok: true, json: async () => ["1000000000", "0", "1100000000", "0"] });
      await expect(aptosAdapter.buildUndelegateTx({ validator: pool, amount: 1_100_000_000n, delegator })).rejects.toMatchObject({ code: "UNBONDING_PERIOD" });
    } finally { globalThis.fetch = originalFetch; }
  });

  it("fails closed on missing or malformed native balances and pending withdrawal responses", async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const balances of [[], ["0", "0"], ["0", "0", "-1"], [0, "0", "0"], ["0", "0", "18446744073709551616"]]) {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => balances });
        await expect(aptosAdapter.buildDelegateTx({ validator: pool, amount: 1_100_000_000n, delegator })).rejects.toThrow(/invalid/i);
      }
      for (const pending of [[true], ["true", "100"], [true, "-1"], [true, 100]]) {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => pending });
        await expect(aptosAdapter.buildClaimTx({ validator: pool, delegator })).rejects.toThrow(/invalid/i);
      }
      await expect(aptosAdapter.buildDelegateTx({ validator: pool, amount: APTOS_MAX_U64 + 1n, delegator })).rejects.toThrow(/u64/);
    } finally { globalThis.fetch = originalFetch; }
  });
});
