import { describe, expect, it } from "vitest";
import { AMOY_SPOL, assertLiquidQuote, assertLiquidState, liquidAmount, usesPolygonLiquid, type LiquidState, type LiquidQuote } from "../polygon-liquid";

const wallet = "0x0000000000000000000000000000000000000011";
const state: LiquidState = {
  chainId: 80002, testOnly: true, token: AMOY_SPOL, wallet,
  router: "0x0000000000000000000000000000000000000022", wrapper: "0x0000000000000000000000000000000000000033", pool: "0x0000000000000000000000000000000000000044",
  paused: false, rateFresh: true, safetyFeeBps: 100, nativeBalance: "10000", sharesBalance: "500",
};
const quote: LiquidQuote = { ...state, direction: "exit", amountIn: "100", amountOut: "100", minimumOut: "99", expiresAt: 31000, priceImpactBps: 20 };

describe("Polygon liquid route", () => {
  it("defaults only testnet Polygon to liquid", () => {
    expect(usesPolygonLiquid("testnet", "polygon", false)).toBe(true);
    expect(usesPolygonLiquid("mainnet", "polygon", false)).toBe(false);
    expect(usesPolygonLiquid("testnet", "polygon", true)).toBe(false);
    expect(usesPolygonLiquid("testnet", "monad", false)).toBe(false);
  });
  it("requires exact decimal input and the test cap", () => {
    expect(liquidAmount("0.01")).toBe(10n ** 16n);
    expect(liquidAmount("1")).toBe(10n ** 18n);
    for (const invalid of ["", "0", "-1", "1.01", "1e-3", "01", "0.0000000000000000001", "Infinity", " 1"])
      expect(() => liquidAmount(invalid)).toThrow();
  });
  it("binds balances to the connected wallet, chain and token", () => {
    expect(() => assertLiquidState(state, wallet)).not.toThrow();
    expect(() => assertLiquidState(state)).toThrow(/different wallet/);
    expect(() => assertLiquidState({ ...state, wallet: state.router }, wallet)).toThrow(/different wallet/);
    for (const patch of [{ chainId: 137 }, { testOnly: false }, { token: state.router }, { nativeBalance: null }, { sharesBalance: "-1" }, { router: "0x0000000000000000000000000000000000000000" as const }])
      expect(() => assertLiquidState({ ...state, ...patch }, wallet)).toThrow();
  });
  it("rejects stale or mismatched quotes and contract reconfiguration", () => {
    expect(() => assertLiquidQuote(quote, state, "exit", 100n, 1000)).not.toThrow();
    for (const patch of [{ expiresAt: 1000 }, { expiresAt: 999999 }, { amountIn: "101" }, { minimumOut: "98" }, { amountOut: "0" }, { testOnly: false }, { router: state.pool }, { priceImpactBps: null }, { priceImpactBps: 501 }])
      expect(() => assertLiquidQuote({ ...quote, ...patch }, state, "exit", 100n, 1000)).toThrow();
    expect(() => assertLiquidQuote(quote, state, "deposit", 100n, 1000)).toThrow();
  });
});
