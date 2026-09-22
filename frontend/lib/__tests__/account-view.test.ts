import { describe, expect, it } from "vitest";
import { accountChain, accountEvents, positionUsd, totalPositionUsd } from "../account-view";
import { stakeAmountWei } from "../stake-input";
import type { PositionRow, RoundSummary } from "../api";
import type { PriceSnapshot } from "../prices";

const position: PositionRow = { contractId: "position-one", argument: { evmAddress: "0x1111111111111111111111111111111111111111", delegator: "party", amountPol: "10.5", status: "Bonded", bondedAt: "2026-09-20T10:00:00Z", markersEmitted: 3 }, chainMeta: { chain: "polygon-mainnet", validatorAddress: null, validatorShare: null, validatorId: null, unbondNonce: null, unbondWithdrawEpoch: null } };
const round: RoundSummary = { roundNumber: 24, status: "completed", startedAt: "2026-09-20T09:50:00Z", completedAt: "2026-09-20T10:02:00Z", relativeTime: "just now", totalCcMinted: "100", totalTxns: 2, totalMarkers: 3, userTrafficSharePct: null, userCcAttributed: null };
const prices = { polUsd: 2, atomUsd: 5 } as PriceSnapshot;

describe("account reference screen data", () => {
  it("uses recorded chain metadata and does not price missing data as zero", () => {
    expect(accountChain(position).id).toBe("polygon");
    expect(positionUsd(position, prices)).toBe(21);
    expect(positionUsd(position)).toBeNull();
    expect(positionUsd({ ...position, chainMeta: undefined }, prices)).toBeNull();
    expect(positionUsd({ ...position, chainMeta: { ...position.chainMeta!, chain: "unknown-evm" } }, prices)).toBeNull();
    expect(positionUsd({ ...position, argument: { ...position.argument, amountPol: "-1" } }, prices)).toBeNull();
    expect(positionUsd(position, { polUsd: 0 } as PriceSnapshot)).toBeNull();
    const cosmos = { ...position, chainMeta: { ...position.chainMeta!, chain: "cosmos" } };
    expect(accountChain(cosmos).id).toBe("cosmos");
    expect(totalPositionUsd([position, cosmos], prices)).toBe(73.5);
    expect(totalPositionUsd([position], { polUsd: NaN } as PriceSnapshot)).toBeNull();
  });
  it("does not turn global rounds into personal reward events", () => {
    expect(accountEvents([position], [round])).toHaveLength(1);
    expect(accountEvents([], [round], false)[0].detail).toContain("100 CC minted");
    expect(accountEvents([], [{ ...round, userCcAttributed: "4" }])[0].detail).toContain("4 CC attributed before split");
  });
  it("shows only timestamped lifecycle events, newest first", () => {
    const result = accountEvents([{ ...position, argument: { ...position.argument, unbondingStartedAt: "2026-09-21T08:00:00Z", releasedAt: "not-a-date" } }], [{ ...round, userCcAttributed: "4" }]);
    expect(result.map(item => item.title)).toEqual(["Unbonding started", "CC round attribution", "Position bonded"]);
  });
});

describe("reviewed stake amounts", () => {
  it("preserves every 18-decimal unit", () => {
    expect(stakeAmountWei("1.000000000000000001")).toBe(1000000000000000001n);
    expect(stakeAmountWei("0.000000000000000001")).toBe(1n);
    expect(stakeAmountWei("1.")).toBe(1000000000000000000n);
  });
  it("rejects malformed, zero, negative, and over-precision inputs before a wallet request", () => {
    for (const value of ["", "0", "0.0", "-1", "1.2.3", "1e3", "Infinity", "1.0000000000000000001"]) expect(stakeAmountWei(value), value).toBeNull();
  });
});
