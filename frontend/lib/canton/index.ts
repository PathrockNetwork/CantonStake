import { loopProvider } from "./loop-provider";
import type { ICantonProvider } from "./types";

const PROVIDERS: Record<string, ICantonProvider> = {
  [loopProvider.id]: loopProvider,
};

export function getProvider(id: string = loopProvider.id): ICantonProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`No Canton provider registered for "${id}"`);
  return p;
}

export function listProviders(): ICantonProvider[] {
  return Object.values(PROVIDERS);
}

/**
 * Returns the highest-priority available provider. When the real
 * @canton-network/dapp-sdk lands and registers a provider that detects
 * `window.canton`, it will outrank the Loop mock automatically.
 */
export function getActiveProvider(): ICantonProvider {
  return listProviders().find((p) => p.isAvailable()) ?? loopProvider;
}

export { useCantonWallet } from "./use-canton-wallet";
export type { UseCantonWalletReturn } from "./use-canton-wallet";
export * from "./types";
