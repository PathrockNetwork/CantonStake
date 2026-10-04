import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiquidHoldings, useLiquidHoldings } from "./LiquidHoldings";
import { AMOY_SPOL, type LiquidState } from "@/lib/polygon-liquid";

const mocks = vi.hoisted(() => ({ address: "0x0000000000000000000000000000000000000011" as string | undefined, mode: "testnet", error: false, loading: false, state: undefined as LiquidState | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));
vi.mock("@/lib/network", () => ({ get networkMode() { return mocks.mode; }, get isMainnet() { return mocks.mode === "mainnet"; } }));
vi.mock("@/components/WalletPickerProvider", () => ({ useWalletPicker: () => ({ openPicker: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.state, isError: mocks.error, isLoading: mocks.loading, refetch: vi.fn() }) }));
beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.address = "0x0000000000000000000000000000000000000011";
  mocks.mode = "testnet"; mocks.error = false; mocks.loading = false;
  mocks.state = { chainId: 80002, testOnly: true, token: AMOY_SPOL, wallet: mocks.address,
    router: "0x0000000000000000000000000000000000000022", wrapper: "0x0000000000000000000000000000000000000033", pool: "0x0000000000000000000000000000000000000044",
    paused: false, rateFresh: true, safetyFeeBps: 100, nativeBalance: "1000000000000000000", sharesBalance: "1849246702846537452", tracking: null };
});
afterEach(() => vi.unstubAllGlobals());
function TestHolding() { return React.createElement(LiquidHoldings, { holdings: useLiquidHoldings() }); }
const render = () => renderToStaticMarkup(React.createElement(TestHolding));

describe("Liquid holdings on Positions", () => {
  it("shows exact wallet holdings without Canton registration and links to swap review", () => {
    const html = render();
    expect(html).toContain("1.849246702846537452 sPOL");
    expect(html).toContain(mocks.address);
    expect(html).toContain("Not enabled");
    expect(html).toContain('href="/stake/liquid?action=exit"');
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Unbond");
    expect(html).not.toContain("Claim");
  });
  it("keeps Amoy holdings hidden on mainnet", () => {
    mocks.mode = "mainnet";
    expect(render()).toBe("");
  });
  it("clears cached balances when the wallet disconnects or changes", () => {
    mocks.address = undefined;
    expect(render()).not.toContain("1.849246");
    mocks.address = "0x0000000000000000000000000000000000000012";
    expect(render()).not.toContain("1.849246");
    expect(render()).not.toContain('href="/stake/liquid?action=exit"');
  });
  it("does not present cached holdings after a refresh error", () => {
    mocks.error = true;
    expect(render()).toContain("temporarily unavailable");
    expect(render()).not.toContain("1.849246");
    expect(render()).not.toContain('href="/stake/liquid?action=exit"');
  });
  it("rejects another chain and malformed balance data", () => {
    mocks.state!.chainId = 137;
    expect(render()).not.toContain("1.849246");
    mocks.state!.chainId = 80002; mocks.state!.sharesBalance = "invalid";
    expect(render()).toContain("temporarily unavailable");
  });
  it("removes the exit action when transfers or exits leave zero shares", () => {
    mocks.state!.sharesBalance = "0";
    expect(render()).toContain("0 sPOL");
    expect(render()).toContain("No holdings");
    expect(render()).not.toContain('href="/stake/liquid?action=exit"');
  });
  it("still displays on-chain holdings when Canton tracking is unavailable", () => {
    mocks.state!.tracking = "unavailable";
    expect(render()).toContain("1.849246702846537452 sPOL");
    expect(render()).toContain("Unavailable");
  });
});
