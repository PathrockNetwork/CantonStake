import type { IChainAdapter } from "./types";
import { cosmosAdapter } from "./cosmos";
import { monadAdapter } from "./monad";
import { moonbeamAdapter } from "./moonbeam";
import { polygonAdapter } from "./polygon";
import { suiAdapter } from "./sui";

const ADAPTERS: Record<string, IChainAdapter> = {
  polygon: polygonAdapter,
  moonbeam: moonbeamAdapter,
  monad: monadAdapter,
  cosmos: cosmosAdapter,
  sui: suiAdapter,
};

export function adapterFor(chainId: string): IChainAdapter {
  const adapter = ADAPTERS[chainId];
  if (!adapter) throw new Error(`No adapter registered for chain ${chainId}`);
  return adapter;
}

export function listAdapterIds(): string[] {
  return Object.keys(ADAPTERS);
}

export * from "./types";
