import { describe, expect, it } from "vitest";
import { valueStaked, type ProtocolSummary } from "../protocol-summary";
const summary = (stakedByChain: Record<string, number>, amountsComplete = true): ProtocolSummary => ({ activePositions: 2, bondedPositions: 2, stakedByChain, amountsComplete, source: "ledger", asOf: "2026-09-21T00:00:00Z" });
describe("protocol valuation", () => {
  it("prices distinct assets separately", () => expect(valueStaked(summary({polygon: 10,sui: 5}),{polygon:0.5,sui:2})).toBe(15));
  it("shows unavailable for unknown prices or incomplete amounts", () => {
    expect(valueStaked(summary({unknown:10}),{polygon:1})).toBeNull();
    expect(valueStaked(summary({polygon:10},false),{polygon:1})).toBeNull();
  });
  it("represents an empty ledger as zero", () => expect(valueStaked(summary({}),{})).toBe(0));
});
