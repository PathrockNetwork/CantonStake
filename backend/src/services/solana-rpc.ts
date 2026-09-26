import { config } from "../config.js";

export const SOLANA_GENESIS = {
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;
export const SOLANA_STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
export const SOLANA_STAKE_ACCOUNT_SPACE = 200;

export async function solanaRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(config.solanaRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Solana ${method} returned ${response.status}`);
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(`Solana ${method}: ${body.error?.message ?? "missing result"}`);
  return body.result;
}

export async function assertSolanaNetwork(): Promise<void> {
  const genesis = await solanaRpc<string>("getGenesisHash");
  const expected = SOLANA_GENESIS[config.networkMode];
  if (genesis !== expected) throw new Error(`Solana RPC genesis ${genesis} does not match ${config.networkMode}`);
}
