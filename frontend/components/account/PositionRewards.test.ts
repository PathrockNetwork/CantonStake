import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionRewards } from "./PositionRewards";
import { AMOY_SPOL, type LiquidState } from "@/lib/polygon-liquid";
import type { PositionRow } from "@/lib/api";

const mocks = vi.hoisted(() => ({ mode: "testnet" }));
vi.mock("@/lib/network", () => ({ get networkMode() { return mocks.mode; }, get isMainnet() { return mocks.mode === "mainnet"; } }));
vi.mock("@/components/WalletPickerProvider", () => ({ useWalletPicker: () => ({ openPicker: vi.fn() }) }));
const wallet = "0x0000000000000000000000000000000000000011";
const state: LiquidState = { chainId: 80002, testOnly: true, token: AMOY_SPOL, wallet,
  router: "0x0000000000000000000000000000000000000022", wrapper: "0x0000000000000000000000000000000000000033", pool: "0x0000000000000000000000000000000000000044",
  paused: false, rateFresh: true, safetyFeeBps: 100, nativeBalance: "1000000000000000000", sharesBalance: "1849246702846537452", tracking: null };
const validator: PositionRow = { contractId: "validator-position", argument: { delegator: "test-party", evmAddress: wallet, amountPol: "2", status: "Bonded", markersEmitted: 0 },
  chainMeta: { chain: "polygon", validatorAddress: null, validatorShare: null, validatorId: null, evmTxHash: null, unbondNonce: null, unbondWithdrawEpoch: null, suiStakedObjectId: null } };
const props = (): React.ComponentProps<typeof PositionRewards> => ({ positions: [validator], totals: new Map([[validator.contractId, 3]]), allocationsAvailable: true,
  holdings: { address: wallet, state, updatedAt: undefined, isLoading: false, isError: false, refetch: vi.fn() }, connected: true, days: 30, positionsUnavailable: false });
const render = (p = props()) => renderToStaticMarkup(React.createElement(PositionRewards, p));
beforeEach(() => { vi.stubGlobal("React", React); mocks.mode = "testnet"; });
afterEach(() => vi.unstubAllGlobals());

describe("Position rewards", () => {
  it("shows liquid holdings and their reward status alongside actual validator allocations", () => {
    const html = render();
    expect(html).toContain("1.849246702846537452 sPOL");
    expect(html).toContain("Liquid staking");
    expect(html).toContain("Not measured");
    expect(html).toContain("Not linked");
    expect(html).toContain("3.00 CC");
    expect(html).toContain("Validator staking");
    expect(html).toContain("/positions?position=liquid%3A80002");
  });
  it("shows a linked liquid holding's CC allocation like validator stake", () => {
    const p = props();
    p.holdings = { ...p.holdings, state: { ...state, ccRewardsEnabled: true } };
    p.totals.set(`liquid:80002:${AMOY_SPOL}:${wallet}`.toLowerCase(), 1.5);
    const html = render(p);
    expect(html).toContain("1.50 CC");
    expect(html).not.toContain("Not linked");
  });
  it("shows liquid reward status without Canton registration or validator positions", () => {
    const p = props(); p.positions = []; p.totals.clear();
    expect(render(p)).toContain("1.849246702846537452 sPOL");
    expect(render(p)).not.toContain("3.00 CC");
  });
  it("keeps cached liquid balances hidden on error and preserves recorded native allocations", () => {
    const p = props(); p.holdings.isError = true;
    expect(render(p)).not.toContain("1.849246");
    expect(render(p)).toContain("temporarily unavailable");
    expect(render(p)).toContain("3.00 CC");
  });
  it("does not display another wallet's holdings or a zero holding", () => {
    const p = props(); p.holdings.address = "0x0000000000000000000000000000000000000012";
    expect(render(p)).not.toContain('data-staking-type="liquid"');
    p.holdings.address = wallet; p.holdings.state = { ...state, sharesBalance: "0" };
    expect(render(p)).not.toContain('data-staking-type="liquid"');
  });
  it("shows unavailable allocations rather than inferring earnings from stake amounts", () => {
    const p = props(); p.allocationsAvailable = false;
    expect(render(p)).not.toContain("3.00 CC");
    expect(render(p)).toContain("Not measured");
  });
  it("retains native allocations on mainnet while excluding the Amoy test holding", () => {
    mocks.mode = "mainnet";
    expect(render()).toContain("3.00 CC");
    expect(render()).not.toContain("Liquid staking");
    expect(render()).not.toContain("1.849246");
  });
  it("identifies Monad by its network, validator, symbol and position link, not just a Canton ID", () => {
    const p = props();
    p.positions = [{ ...validator, argument: { ...validator.argument, amountPol: "10" }, chainMeta: { ...validator.chainMeta!, chain: "monad", validatorAddress: "173", validatorId: 173 } }];
    p.totals.clear();
    const html = render(p);
    expect(html).toContain("Monad Testnet");
    expect(html).toContain("Monad · Validator #173");
    expect(html).toContain("10.00 MON bonded");
    expect(html).toContain("/networks/monad.svg");
    expect(html).toContain("No CC allocations recorded in this period.");
    expect(html).toContain("/positions?position=validator-position");
  });
});
