import type { IChainAdapter } from "./types";
import { bnbAdapter } from "./bnb";
import { aptosAdapter } from "./aptos";
import { cosmosAdapter, celestiaAdapter, osmosisAdapter } from "./cosmos";
import { monadAdapter } from "./monad";
import { polygonAdapter } from "./polygon";
import { suiAdapter } from "./sui";
import { solanaAdapter } from "./solana";
import { polkadotAdapter } from "./polkadot";

const ADAPTERS: Record<string, IChainAdapter> = {
  polygon: polygonAdapter,
  monad: monadAdapter,
  cosmos: cosmosAdapter,
  celestia: celestiaAdapter,
  osmosis: osmosisAdapter,
  sui: suiAdapter,
  bnb: bnbAdapter,
  aptos: aptosAdapter,
  solana: solanaAdapter,
  polkadot: polkadotAdapter,
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
