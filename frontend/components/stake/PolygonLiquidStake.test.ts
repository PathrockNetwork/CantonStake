import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolygonLiquidStake } from "./PolygonLiquidStake";
import { AMOY_SPOL } from "@/lib/polygon-liquid";

const mocks = vi.hoisted(() => ({
  address: "0x0000000000000000000000000000000000000011" as string | undefined,
  chainId: 80002, mainnet: false, unavailable: false,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.address, chainId: mocks.chainId }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));
vi.mock("@wagmi/core", () => ({ getAccount: vi.fn(), getPublicClient: vi.fn(), sendTransaction: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/network", () => ({ get isMainnet() { return mocks.mainnet; }, get networkMode() { return mocks.mainnet ? "mainnet" : "testnet"; } }));
vi.mock("@/components/WalletPickerProvider", () => ({ useWalletPicker: () => ({ openPicker: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({
  isError: mocks.unavailable, error: new Error("RPC unavailable"), refetch: vi.fn(),
  data: { chainId: 80002, testOnly: true, token: AMOY_SPOL, wallet: mocks.address,
    nativeBalance: "123450000000000000", sharesBalance: "5000000000000000",
    safetyFeeBps: 100, paused: false, rateFresh: true, tracking: null },
}) }));

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.address = "0x0000000000000000000000000000000000000011";
  mocks.chainId = 80002; mocks.mainnet = false; mocks.unavailable = false;
});
afterEach(() => vi.unstubAllGlobals());
const render = () => renderToStaticMarkup(React.createElement(PolygonLiquidStake));

describe("Amoy liquid staking screen", () => {
  it("opens a positions exit link with sPOL as the input and a fresh quote required", () => {
    const html = renderToStaticMarkup(React.createElement(PolygonLiquidStake, { initialDirection: "exit" }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Swap exit to Amoy POL/);
    expect(html).toContain("Pooled sPOL in. Native POL out.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm approval \/ swap/);
  });
  it("shows the connected wallet's test balances, no CC promise and a disabled canonical exit", () => {
    const html = render();
    expect(html).toContain(mocks.address);
    expect(html).toContain("Amoy test POL: 0.12345");
    expect(html).toContain("Amoy sPOL: 0.005");
    expect(html).toContain("CC rewards are disabled");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Queued exit unavailable/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm Amoy deposit/);
    expect(html).not.toContain("Switch to Polygon Amoy</button>");
  });
  it("asks a Sepolia wallet to switch to Amoy, never the reverse", () => {
    mocks.chainId = 11155111;
    expect(render()).toContain("Switch to Polygon Amoy</button>");
    expect(render()).not.toContain("Switch to Sepolia</button>");
  });
  it("does not expose a cached account balance while disconnected or unavailable", () => {
    mocks.address = undefined;
    expect(render()).not.toContain("0.12345");
    expect(render()).not.toContain("0.005");
    mocks.address = "0x0000000000000000000000000000000000000011";
    mocks.unavailable = true;
    expect(render()).not.toContain("0.12345");
    expect(render()).toContain("No transaction will be submitted");
  });
  it("never enables the Amoy test route on mainnet", () => {
    mocks.mainnet = true;
    expect(render()).toContain("Back to mainnet staking");
    expect(render()).not.toContain("Confirm Amoy deposit");
  });
  it("keeps the heading before the network workspace and optional tracking after the form", () => {
    const html = renderToStaticMarkup(React.createElement(PolygonLiquidStake, { networkPicker: React.createElement("div", null, "NETWORK_PICKER") }));
    expect(html.indexOf("page-masthead")).toBeLessThan(html.indexOf("NETWORK_PICKER"));
    expect(html.indexOf("Liquid stake amount")).toBeLessThan(html.indexOf("Canton balance tracking"));
    expect(html).toContain('class="account-liquid-tabs" role="group" aria-label="Staking action"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Stake Amoy POL/);
    expect(html).toMatch(/<details class="account-liquid-details"><summary>Canton balance tracking/);
    expect(html).not.toContain('<details class="account-liquid-details" open');
  });
});
