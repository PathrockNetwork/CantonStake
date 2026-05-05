import type { IChainAdapter } from "./types";
import { polygonAdapter } from "./polygon";

const ADAPTERS: Record<string, IChainAdapter> = {
  polygon: polygonAdapter,
};

export function adapterFor(chainId: string): IChainAdapter {
  const adapter = ADAPTERS[chainId];
  if (!adapter) throw new Error(`No adapter registered for chain ${chainId}`);
  return adapter;
}

export * from "./types";
