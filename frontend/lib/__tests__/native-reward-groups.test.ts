import { describe, expect, it } from "vitest";
import { nativeRewardGroups } from "../native-reward-groups";
import type { RewardHistoryEvent } from "../api";

const payout: RewardHistoryEvent = { id: "payout", kind: "native", time: "2026-09-30T00:00:00Z", amount: "1.25", symbol: "POL",
  positionId: "position", chain: "polygon", roundNumber: null, transactionId: "tx", status: "Recorded" };
describe("recorded native payout groups", () => {
  it("does not create an empty POL stream or turn CC allocations into native earnings", () => {
    expect(nativeRewardGroups([])).toEqual([]);
    expect(nativeRewardGroups([{ ...payout, kind: "cc", symbol: "CC" }])).toEqual([]);
  });
  it("totals only the recorded events in the supplied period", () => {
    const groups = nativeRewardGroups([payout, { ...payout, id: "second", amount: "0.75" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(2);
    expect(groups[0].events).toHaveLength(2);
  });
  it("never combines MON with POL or relabels Monad as Polygon", () => {
    const groups = nativeRewardGroups([payout, { ...payout, id: "monad", chain: "monad", symbol: "MON", amount: "3" }]);
    expect(groups.map(g => [g.chain, g.symbol, g.total])).toEqual([["polygon", "POL", 1.25], ["monad", "MON", 3]]);
  });
  it("keeps different networks separate even when their token symbol matches", () => {
    expect(nativeRewardGroups([payout, { ...payout, chain: "another-network" }])).toHaveLength(2);
  });
  it("invalid payout amounts are unavailable, never replaced by a fabricated zero", () => {
    for (const amount of ["", "-1", "NaN", "Infinity", "1e1000"]) {
      expect(nativeRewardGroups([payout, { ...payout, amount }])[0].total).toBeUndefined();
    }
  });
});
