import { describe, expect, it } from "vitest";
import { accountChain, accountEvents, liquidUsd, positionUsd, totalPositionUsd, rewardPositionLabel } from "../account-view";
import type { LiquidState } from "../polygon-liquid";
import { stakeAmountWei } from "../stake-input";
import type { PositionRow, RoundSummary } from "../api";
import type { PriceSnapshot } from "../prices";

const position: PositionRow = { contractId: "position-one", argument: { evmAddress: "0x1111111111111111111111111111111111111111", delegator: "party", amountPol: "10.5", status: "Bonded", bondedAt: "2026-09-20T10:00:00Z", markersEmitted: 3 }, chainMeta: { chain: "polygon-mainnet", validatorAddress: null, validatorShare: null, validatorId: null, evmTxHash: null, unbondNonce: null, unbondWithdrawEpoch: null, suiStakedObjectId: null } };
const round: RoundSummary = { roundNumber: 24, status: "completed", startedAt: "2026-09-20T09:50:00Z", completedAt: "2026-09-20T10:02:00Z", relativeTime: "just now", totalCcMinted: "100", totalTxns: 2, totalMarkers: 3, userTrafficSharePct: null, userCcAttributed: null };
const prices = { polUsd: 2, atomUsd: 5 } as PriceSnapshot;

describe("account reference screen data", () => {
  it("uses recorded chain metadata and does not price missing data as zero", () => {
    expect(accountChain(position).id).toBe("polygon");
    expect(positionUsd(position, prices)).toBe(21);
    expect(positionUsd(position)).toBeNull();
    expect(positionUsd({ ...position, chainMeta: undefined }, prices)).toBeNull();
    expect(positionUsd({ ...position, chainMeta: { ...position.chainMeta!, chain: "unknown-evm" } }, prices)).toBeNull();
    expect(positionUsd({ ...position, chainMeta: { ...position.chainMeta!, chain: "polygon-unknown" } }, prices)).toBeNull();
    // Test chains are valued at MainNet prices (labelled as such in the UI).
    expect(positionUsd({ ...position, chainMeta: { ...position.chainMeta!, chain: "polygon-amoy" } }, prices)).toBe(21);
    expect(positionUsd({ ...position, chainMeta: { ...position.chainMeta!, chain: "polygon-testnet" } }, prices)).toBe(21);
    expect(positionUsd({ ...position, argument: { ...position.argument, amountPol: "-1" } }, prices)).toBeNull();
    expect(positionUsd(position, { polUsd: 0 } as PriceSnapshot)).toBeNull();
    const cosmos = { ...position, chainMeta: { ...position.chainMeta!, chain: "cosmos" } };
    expect(accountChain(cosmos).id).toBe("cosmos");
    expect(accountChain({ ...position, argument: { ...position.argument, evmAddress: "celestia1wallet" }, chainMeta: undefined }).id).toBe("celestia");
    expect(accountChain({ ...position, argument: { ...position.argument, evmAddress: "osmo1wallet" }, chainMeta: undefined }).id).toBe("osmosis");
    expect(accountChain({ ...position, chainMeta: { ...position.chainMeta!, chain: "osmosis" } }).id).toBe("osmosis");
    const westend = { ...position, argument: { ...position.argument, evmAddress: "5GF4poPj97U3JgThX7KHYvSwVbG3SNYWRugHvk8eJoedErFN" }, chainMeta: undefined };
    expect(accountChain(westend).id).toBe("polkadot");
    expect(accountChain({ ...position, argument: { ...position.argument, evmAddress: "ARdcMV5iHw2uWFGZ9GkYyvNaSRJshFCbDxG7C69c1WHa" }, chainMeta: undefined }).id).toBe("solana");
    expect(positionUsd({ ...westend, chainMeta: { ...position.chainMeta!, chain: "polkadot-testnet" } }, { dotUsd: 7 } as PriceSnapshot)).toBe(73.5);
    expect(positionUsd({ ...westend, chainMeta: { ...position.chainMeta!, chain: "polkadot-mainnet" } }, { dotUsd: 7 } as PriceSnapshot)).toBe(73.5);
    expect(totalPositionUsd([position, cosmos], prices)).toBe(73.5);
    expect(totalPositionUsd([position], { polUsd: NaN } as PriceSnapshot)).toBeNull();
    const large = { ...position, argument: { ...position.argument, amountPol: "1e308" } };
    expect(positionUsd(large, { polUsd: 2 } as PriceSnapshot)).toBeNull();
    expect(totalPositionUsd([large, large], { polUsd: 1 } as PriceSnapshot)).toBeNull();
    const liquid = { polValue: "2500000000000000000" } as LiquidState;
    expect(liquidUsd(liquid, prices)).toBe(5);
    expect(liquidUsd({ ...liquid, polValue: null }, prices)).toBeNull();
    expect(liquidUsd(liquid)).toBeNull();
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
  it("labels reward filters with the recorded chain and validator", () => {
    const monad = { ...position, chainMeta: { ...position.chainMeta!, chain: "monad", validatorId: 173 } };
    expect(rewardPositionLabel(monad)).toBe("Monad · Validator #173");
    expect(rewardPositionLabel({ ...monad, chainMeta: { ...monad.chainMeta, validatorId: 0 } })).toBe("Monad · Validator #0");
    expect(rewardPositionLabel(position)).toBe("Polygon PoS · Position position-one");
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
