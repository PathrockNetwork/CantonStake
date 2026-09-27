import { networkMode } from "./network";

export type RpcPoolName = "settlement" | "polygon" | "monad" | "bnb" | "cosmos" | "cosmos-rest" |
  "celestia" | "celestia-rest" | "osmosis" | "osmosis-rest" | "aptos" | "aptos-indexer" | "sui" | "solana" | "polkadot";

/** Shared, chain-verified failover without exposing provider keys in bundles. */
export function rpcEndpoint(pool: RpcPoolName): string {
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001").replace(/\/$/, "");
  return `${base}/api/rpc/${networkMode}/${pool}`;
}
