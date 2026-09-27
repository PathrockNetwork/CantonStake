import { describe, expect, it } from "vitest";
import { isCantonReadyForStaking } from "../staking-readiness";
import type { CantonReadiness } from "../api";

const ready: CantonReadiness = {
  status: "ready", canton: "reachable", networkMode: "testnet", time: "2026-09-26T00:00:00Z",
};

describe("Canton staking readiness", () => {
  it("requires a reachable ledger on the same network mode", () => {
    expect(isCantonReadyForStaking(ready, "testnet")).toBe(true);
    expect(isCantonReadyForStaking(ready, "mainnet")).toBe(false);
    expect(isCantonReadyForStaking({ ...ready, networkMode: "mainnet" }, "mainnet")).toBe(true);
  });
  it("fails closed while loading, unavailable, inconsistent or after a failed refresh", () => {
    expect(isCantonReadyForStaking(undefined, "testnet")).toBe(false);
    expect(isCantonReadyForStaking({ ...ready, status: "unavailable" }, "testnet")).toBe(false);
    expect(isCantonReadyForStaking({ ...ready, canton: "unreachable" }, "testnet")).toBe(false);
    expect(isCantonReadyForStaking(ready, "testnet", true)).toBe(false);
  });
});
