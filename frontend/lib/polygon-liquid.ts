import { isAddress, parseEther, type Address } from "viem";

// The configured wagmi chain union varies between mainnet and testnet builds.
export const AMOY_LIQUID_CHAIN: number = 80002;
export const AMOY_SPOL = "0x3c7a9412b9ab03aad2129a2c2159372516011e45" as const;
export type LiquidDirection = "deposit" | "exit";
export type LiquidState = {
  chainId: number; testOnly: boolean; token: string; wallet: string | null;
  router: Address; wrapper: Address; pool: Address;
  paused: boolean; rateFresh: boolean; safetyFeeBps: number;
  nativeBalance: string | null; sharesBalance: string | null;
  tracking?: { shares: string; observedBlock: string } | "unavailable" | null;
};
export type LiquidQuote = {
  chainId: number; testOnly: boolean; token: string;
  router: Address; wrapper: Address; pool: Address;
  amountIn: string; amountOut: string; minimumOut: string;
  expiresAt: number; direction: LiquidDirection; priceImpactBps: number | null;
};

export function liquidAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw Error("Enter a decimal amount with at most 18 places");
  const units = parseEther(value);
  if (units <= 0n || units > parseEther("1")) throw Error("Enter more than zero and at most 1 test token");
  return units;
}

export function liquidRouteKey(route: Pick<LiquidState, "chainId" | "token" | "router" | "wrapper" | "pool">) {
  return [route.chainId, route.token, route.router, route.wrapper, route.pool].join(":").toLowerCase();
}

export function assertLiquidState(state: LiquidState, wallet?: string): void {
  if (state.chainId !== AMOY_LIQUID_CHAIN || state.testOnly !== true || state.token?.toLowerCase() !== AMOY_SPOL)
    throw Error("Wrong liquid staking deployment");
  if ([state.router, state.wrapper, state.pool].some(a => !isAddress(a) || /^0x0{40}$/i.test(a)))
    throw Error("Liquid swap contracts are not configured");
  if ((state.wallet?.toLowerCase() ?? null) !== (wallet?.toLowerCase() ?? null))
    throw Error("Balance response belongs to a different wallet");
  if (wallet && [state.nativeBalance, state.sharesBalance].some(v => typeof v !== "string" || !/^\d+$/.test(v)))
    throw Error("Wallet balances unavailable");
}

export async function fetchLiquidState(wallet?: string, signal?: AbortSignal): Promise<LiquidState> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";
  const response = await fetch(`${base}/api/polygon/liquid${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Liquid holdings unavailable");
  assertLiquidState(data, wallet);
  return data;
}

export function assertLiquidQuote(quote: LiquidQuote, state: LiquidState, direction: LiquidDirection, amount: bigint, now = Date.now()): void {
  if (quote.testOnly !== true || liquidRouteKey(quote) !== liquidRouteKey(state) || quote.direction !== direction || quote.amountIn !== String(amount))
    throw Error("Quote does not match this route and amount");
  if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= now || quote.expiresAt > now + 35_000)
    throw Error("Quote expired; get a fresh quote before continuing");
  if (![quote.amountOut, quote.minimumOut].every(v => /^[1-9]\d*$/.test(v)) || BigInt(quote.minimumOut) !== BigInt(quote.amountOut) * 99n / 100n)
    throw Error("Invalid quote output");
  if (direction === "exit" && (!Number.isInteger(quote.priceImpactBps) || quote.priceImpactBps! < 0 || quote.priceImpactBps! > 500))
    throw Error("Exit price impact exceeds the 5% test-route limit");
}

export function usesPolygonLiquid(mode: string, chain: string, advanced: boolean) {
  return mode === "testnet" && chain === "polygon" && !advanced;
}
