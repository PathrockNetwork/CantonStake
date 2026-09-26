import { isMainnet } from "../network";

export const solanaNetwork = {
  name: isMainnet ? "mainnet-beta" : "testnet",
  rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || (isMainnet ? "https://api.mainnet-beta.solana.com" : "https://api.testnet.solana.com"),
  genesis: isMainnet
    ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    : "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

export function assertSolanaGenesis(actual: string): void {
  if (actual !== solanaNetwork.genesis) {
    throw new Error(`Solana RPC genesis ${actual} does not match ${solanaNetwork.name}`);
  }
}
