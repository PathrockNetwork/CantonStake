import { describe, expect, it } from "vitest";
import { filterPositionList, positionList } from "../position-list";
import { AMOY_SPOL, type LiquidState } from "../polygon-liquid";
import type { PositionRow } from "../api";

const wallet = "0x0000000000000000000000000000000000000011";
const state: LiquidState = { chainId: 80002, testOnly: true, token: AMOY_SPOL, wallet,
  router: "0x0000000000000000000000000000000000000022", wrapper: "0x0000000000000000000000000000000000000033", pool: "0x0000000000000000000000000000000000000044",
  paused: false, rateFresh: true, safetyFeeBps: 100, nativeBalance: "1000000000000000000", sharesBalance: "1849246702846537452", tracking: null };
const validator: PositionRow = { contractId: "validator-position", argument: { delegator: "test-party", evmAddress: wallet, amountPol: "2", status: "Bonded", markersEmitted: 0, bondedAt: "2026-09-30T00:00:00Z" },
  chainMeta: { chain: "polygon", validatorAddress: null, validatorShare: null, validatorId: null, evmTxHash: null, unbondNonce: null, unbondWithdrawEpoch: null, suiStakedObjectId: null } };
const filters = { status: "all", chain: "all", kind: "all", search: "", order: "newest" };

describe("Combined positions list", () => {
  it("includes a liquid holding alongside validator positions without inventing a contract or bond date", () => {
    const rows = positionList([validator], state, wallet);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "validator", position: validator });
    expect(rows[1]).toMatchObject({ kind: "liquid", symbol: "sPOL", amount: "1.849246702846537452", status: "Active", timestamp: null });
    expect(rows[1]).not.toHaveProperty("position");
    expect(rows[1].id).toContain(wallet);
  });
  it("searches and filters liquid staking by type, chain, status and token", () => {
    const rows = positionList([validator], state, wallet);
    for (const query of [{ kind: "liquid" }, { status: "Active" }, { search: "liquid staking" }, { search: "spol" }, { search: "amoy" }]) {
      expect(filterPositionList(rows, { ...filters, ...query }).map(p => p.kind)).toEqual(["liquid"]);
    }
    expect(filterPositionList(rows, { ...filters, chain: "polygon" })).toHaveLength(2);
    expect(filterPositionList(rows, { ...filters, kind: "validator" })).toHaveLength(1);
    expect(filterPositionList(rows, { ...filters, status: "Bonded" })[0].kind).toBe("validator");
  });
  it("keeps the liquid entry identity stable as the balance updates", () => {
    const first = positionList([], state, wallet)[0];
    const second = positionList([], { ...state, sharesBalance: "500000000000000000" }, wallet)[0];
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe("0.5");
  });
  it("omits liquid entries on zero, disconnected, wrong-wallet or wrong-network data", () => {
    expect(positionList([], { ...state, sharesBalance: "0" }, wallet)).toEqual([]);
    expect(positionList([], state)).toEqual([]);
    expect(positionList([], state, "0x0000000000000000000000000000000000000012")).toEqual([]);
    expect(positionList([], { ...state, chainId: 137 }, wallet)).toEqual([]);
  });
  it("sorts amounts and keeps undated holdings behind dated stakes for date ordering", () => {
    const rows = positionList([validator], state, wallet);
    expect(filterPositionList(rows, { ...filters, order: "amount" })[0].id).toBe(validator.contractId);
    expect(filterPositionList(rows, { ...filters, order: "oldest" })[0].id).toBe(validator.contractId);
  });
});
