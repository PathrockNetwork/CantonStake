import { loopSdkProvider } from "./loop-sdk-provider";
import type { ICantonProvider } from "./types";

// Order matters: getActiveProvider() returns the first `isAvailable()` hit.
const PROVIDER_LIST: ICantonProvider[] = [loopSdkProvider];

const PROVIDERS: Record<string, ICantonProvider> = Object.fromEntries(
  PROVIDER_LIST.map((p) => [p.id, p]),
);

export function getProvider(id: string = loopSdkProvider.id): ICantonProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`No Canton provider registered for "${id}"`);
  return p;
}

export function listProviders(): ICantonProvider[] {
  return PROVIDER_LIST;
}

/** Returns the highest-priority available provider. */
export function getActiveProvider(): ICantonProvider {
  return PROVIDER_LIST.find((p) => p.isAvailable()) ?? loopSdkProvider;
}

export { useCantonWallet } from "./use-canton-wallet";
export type { UseCantonWalletReturn } from "./use-canton-wallet";
export { useLoopHoldings } from "./use-loop-holdings";
export type { LoopHolding, UseLoopHoldingsResult } from "./use-loop-holdings";
export * from "./types";
