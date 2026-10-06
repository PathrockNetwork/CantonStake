import { loopSdkProvider } from "./loop-sdk-provider";
import type { ICantonProvider } from "./types";

// Order matters: getActiveProvider() returns the first `isAvailable()` hit.
const PROVIDER_LIST: ICantonProvider[] = [loopSdkProvider];

/** Returns the highest-priority available provider. */
export function getActiveProvider(): ICantonProvider {
  return PROVIDER_LIST.find((p) => p.isAvailable()) ?? loopSdkProvider;
}

export { useCantonWallet } from "./use-canton-wallet";
export type { UseCantonWalletReturn } from "./use-canton-wallet";
export * from "./types";
