import type { CantonNetwork } from "./types";

export function resolveLoopNetwork(raw = "devnet"): CantonNetwork {
  const network = raw.trim().toLowerCase() || "devnet";
  if (["local", "devnet", "testnet", "mainnet"].includes(network)) return network as CantonNetwork;
  throw new Error(`Unsupported Loop network: ${raw}. Refusing to fall back to another network.`);
}

export function loopWalletUrl(network: CantonNetwork): string {
  return network === "local" ? "http://localhost:3000"
    : network === "mainnet" ? "https://cantonloop.com"
    : `https://${network}.cantonloop.com`;
}

export interface LoopStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SCOPE_KEY = "cantonstake_loop_session_scope";
// Loop's singleton stores no network alongside its ticket. Never resume a
// ticket created against another network or an unidentified legacy endpoint.
export function scopeLoopSession(storage: LoopStorage, scope: string): void {
  if (storage.getItem(SCOPE_KEY) !== scope) storage.removeItem("loop_connect");
  storage.removeItem("cantonstake_loop_sdk_identity");
  storage.setItem(SCOPE_KEY, scope);
}

export function loopSessionScope(network: CantonNetwork, walletUrl?: string, apiUrl?: string): string {
  return JSON.stringify([network, walletUrl || loopWalletUrl(network), apiUrl || loopWalletUrl(network)]);
}

/** Canton networks where the external Loop staking flow may run. */
export const isLoopStakingNetwork = (network: CantonNetwork): network is "devnet" | "testnet" =>
  network === "devnet" || network === "testnet";
